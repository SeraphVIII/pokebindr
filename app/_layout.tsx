// Root layout — providers + auth gate.
// Loads fonts, wraps with React-Query + Session contexts, then renders
// either the (auth) group or the (tabs) group based on session state.

import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, ActivityIndicator } from 'react-native';
import {
  useFonts as useCormorantFonts,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  Manrope_500Medium,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono';

import { SessionProvider, useSession } from '@/lib/auth';
import { theme } from '@/lib/theme';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/ConfirmDialog';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const segment0 = segments[0];

  useEffect(() => {
    if (loading) return;
    const inAuth = segment0 === '(auth)';
    // /u/[username]/... and /share/[token] are accessible without an account
    // so visitors can view shared binders. /reset-password must also render
    // session-less: the recovery deep link lands here BEFORE we call setSession,
    // so without this it would bounce to /sign-in before the token is consumed.
    const inPublic = segment0 === 'u' || segment0 === 'share' || segment0 === 'reset-password';
    if (!session && !inAuth && !inPublic) router.replace('/sign-in');
    else if (session && inAuth) router.replace('/');
  }, [session, loading, segment0, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useCormorantFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    Manrope_500Medium,
    Manrope_700Bold,
    IBMPlexMono_500Medium,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: theme.maxContentW, backgroundColor: theme.bg }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <ToastProvider>
              <ConfirmProvider>
                <StatusBar style="light" />
                <AuthGate>
                  {/* Root navigator MUST be Stack, not Slot — Slot renders
                      child routes as sibling content without push/pop
                      semantics, so router.back() from any root-level pushed
                      route (/card/[id], /scan, /collection, …) couldn't find a
                      previous frame and silently fell back to home. Stack gives
                      every navigation a real entry to pop. headerShown:false
                      keeps the existing per-screen custom headers. */}
                  <Stack screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: theme.bg },
                  }} />
                </AuthGate>
              </ConfirmProvider>
              </ToastProvider>
            </SessionProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}
