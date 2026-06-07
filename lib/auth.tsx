// Auth context — exposes session + helpers to children.
// Routes use `useSession()` to gate access.

import { Session } from '@supabase/supabase-js';
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

interface Ctx {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Track which user the cache currently belongs to. Switching users (or
  // signing out) must clear the cache so e.g. user-scoped queryKeys like
  // ['profile', 'me'] don't leak rows between accounts.
  const cacheUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Bootstrap may throw "Invalid Refresh Token" when SecureStore holds a
    // token whose server-side session was expired or revoked (manual user
    // delete in the dashboard, long-idle install, etc.). Catch it, force a
    // sign-out to wipe the bad token, and treat the user as logged-out so
    // the AuthGate redirects them to /sign-in cleanly instead of looping.
    const handleAuthBootError = async (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? String(e);
      const isStaleToken =
        msg.includes('Refresh Token') ||
        msg.includes('refresh_token') ||
        msg.includes('Invalid Refresh');
      if (isStaleToken) {
        try { await supabase.auth.signOut(); } catch { /* already gone */ }
      }
      cacheUserIdRef.current = null;
      setSession(null);
      setLoading(false);
    };
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) return handleAuthBootError(error);
        cacheUserIdRef.current = data.session?.user.id ?? null;
        setSession(data.session);
        setLoading(false);
      })
      .catch(handleAuthBootError);
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      // TOKEN_REFRESHED with no session means the refresh attempt failed mid-
      // flight (token revoked while app was running) — clear cache, drop to
      // signed-out so AuthGate kicks the user back to sign-in.
      const nextId = s?.user.id ?? null;
      if (nextId !== cacheUserIdRef.current) {
        queryClient.clear();
        cacheUserIdRef.current = nextId;
      }
      setSession(s);
      if (e === 'SIGNED_OUT') setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };
  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };
  const signOut = async () => {
    await supabase.auth.signOut();
  };
  const resetPassword = async (email: string) => {
    // Point the email link back into the app via the `pokebindr://` scheme so
    // the recovery flow finishes in-app (app/reset-password.tsx) rather than on
    // a web page. The resolved URL must be added to Supabase's redirect
    // allow-list (Authentication → URL Configuration). In a dev client this
    // resolves to an exp:// URL on your LAN, which is awkward to allow-list —
    // the deep link works cleanly in a standalone EAS build.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('reset-password'),
    });
    if (error) throw error;
  };

  return (
    <SessionCtx.Provider value={{ session, loading, signIn, signUp, signOut, resetPassword }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
