// Password recovery — the landing screen for the "forgot password" email link.
//
// Flow: user taps the email link → Supabase verifies the recovery token and
// redirects to `pokebindr://reset-password#access_token=…&refresh_token=…` →
// this screen parses those tokens from the URL fragment, calls setSession to
// establish a (recovery) session, then shows a form to set a new password via
// updateUser. On success the user is already signed in, so we drop them into
// the app.
//
// We parse the fragment by hand rather than relying on the client's
// detectSessionInUrl (it's off, and disabled on native anyway). Top-level route
// so AuthGate lets it render session-less while the token is being consumed.

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabase';
import { theme } from '@/lib/theme';

/** Pull the auth tokens Supabase appends to the redirect URL fragment. */
function parseFragment(url: string) {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const out: Record<string, string> = {};
  for (const part of hash.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1));
    out[k] = v;
  }
  return out;
}

type Phase = 'verifying' | 'ready' | 'error';

export default function ResetPassword() {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  // The url listener can fire more than once (cold start + event); only the
  // first valid token is consumed.
  const handled = useRef(false);

  useEffect(() => {
    const consume = async (url: string | null) => {
      if (!url || handled.current) return;
      const f = parseFragment(url);
      if (f.error || f.error_description) {
        handled.current = true;
        setLinkError(f.error_description || f.error || 'Invalid link');
        setPhase('error');
        return;
      }
      if (f.access_token && f.refresh_token) {
        handled.current = true;
        const { error } = await supabase.auth.setSession({
          access_token: f.access_token,
          refresh_token: f.refresh_token,
        });
        if (error) { setLinkError(error.message); setPhase('error'); }
        else setPhase('ready');
      }
    };
    Linking.getInitialURL().then(consume);
    const sub = Linking.addEventListener('url', (e) => consume(e.url));
    return () => sub.remove();
  }, []);

  const submit = async () => {
    if (password.length < 8) { toast.error('Use at least 8 characters.'); return; }
    if (password !== confirm) { toast.error('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password updated.');
      router.replace('/');
    } catch (e: any) {
      toast.error(e.message ?? 'Could not update password');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'verifying') {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
        <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 14, fontFamily: theme.fontUI }}>
          Verifying your reset link…
        </Text>
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen style={{ padding: 28, justifyContent: 'center' }}>
        <Eyebrow>Link problem</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay, fontSize: 30, lineHeight: 34,
          color: theme.text, marginTop: 6, marginBottom: 12,
        }}>
          This reset link{'\n'}
          <Text style={{ color: theme.accent }}>didn’t work.</Text>
        </Text>
        <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 28, fontFamily: theme.fontUI }}>
          {linkError ?? 'It may have expired or already been used.'} Request a new one from the sign-in screen.
        </Text>
        <Pressable
          onPress={() => router.replace('/sign-in')}
          style={{ backgroundColor: theme.accent, padding: 16, borderRadius: theme.radius }}
        >
          <Text style={{
            color: theme.accentText, textAlign: 'center', fontFamily: theme.fontUIBold,
            fontSize: 14, letterSpacing: 0.5, textTransform: 'uppercase',
          }}>Back to sign in</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 28 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ height: 36 }} />
        <Eyebrow>Collector's archive</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay, fontSize: 38, lineHeight: 42,
          color: theme.text, marginTop: 6, marginBottom: 12,
        }}>
          Set a{'\n'}
          <Text style={{ color: theme.accent }}>new password.</Text>
        </Text>
        <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 32, fontFamily: theme.fontUI }}>
          Choose a new password for your account. You’ll be signed in once it’s saved.
        </Text>

        <Field label="New password" value={password} onChange={setPassword} secureTextEntry />
        <View style={{ height: 16 }} />
        <Field label="Confirm password" value={confirm} onChange={setConfirm} secureTextEntry />

        <Pressable
          onPress={submit}
          disabled={busy}
          style={{
            backgroundColor: theme.accent,
            padding: 16, borderRadius: theme.radius, marginTop: 24,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{
            color: theme.accentText, textAlign: 'center', fontFamily: theme.fontUIBold,
            fontSize: 14, letterSpacing: 0.5, textTransform: 'uppercase',
          }}>Save password</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, value, onChange, ...rest }: any) {
  return (
    <View>
      <Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        placeholderTextColor={theme.textMute}
        style={{
          backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.border,
          borderRadius: theme.radius,
          padding: 14, fontSize: 15,
          color: theme.text,
          fontFamily: theme.fontUI,
        }}
        {...rest}
      />
    </View>
  );
}
