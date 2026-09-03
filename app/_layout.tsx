// Root layout: providers + auth gate.

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
    // /u/*, /share/*, and /reset-password must render session-less; the
    // recovery deep link lands on /reset-password before setSession runs.
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
                  {/* Must be a Stack, not Slot: Slot gives pushed root routes
                      no history entry, so router.back() falls through to home. */}
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
