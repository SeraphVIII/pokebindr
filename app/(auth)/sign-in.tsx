// Sign-in screen. Single form, toggles between sign-in / sign-up.

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { AmbientGlow, Button } from '@/components/ui';
import { useSession } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';

const enter = (i: number) => FadeInDown.duration(420).delay(80 * i).springify().damping(24);

export default function SignIn() {
  const { signIn } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) {
      toast.error('Email and password required.');
      return;
    }
    // No transactional email is configured; accounts are provisioned from the
    // Supabase dashboard, so self-service sign-up cannot complete.
    if (mode === 'signup') {
      toast.error('Account creation is invite-only right now. Ask the admin to set you up.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e: any) {
      toast.error(e.message ?? 'Auth error');
    } finally {
      setBusy(false);
    }
  };

  // No transactional email is configured; password resets are handled from
  // the Supabase dashboard.
  const onForgotPassword = () => {
    toast.info('Password resets are handled by the admin — reach out to get yours reset.');
  };

  return (
    <Screen style={{ padding: 28 }}>
      <AmbientGlow size={340} style={{ top: -120, right: -120 }} opacity={0.12} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ height: 36 }} />

        <Animated.View entering={enter(0)} style={{
          alignSelf: 'flex-start',
          backgroundColor: theme.shell,
          borderWidth: 1, borderColor: theme.hairline,
          borderRadius: 18, padding: 4,
          marginBottom: 32,
          boxShadow: theme.shadowGold,
        }}>
          <View style={{
            width: 54, height: 54, borderRadius: 14,
            borderWidth: 1, borderColor: theme.borderStrong,
            backgroundColor: theme.surface,
            alignItems: 'center', justifyContent: 'center',
            boxShadow: theme.shadowInner,
          }}>
            <Text style={{
              fontFamily: theme.fontDisplaySemi, fontSize: 28,
              color: theme.accent,
            }}>P</Text>
          </View>
        </Animated.View>

        <Animated.View entering={enter(1)}>
          <Eyebrow>Collector's archive</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 40, lineHeight: 46,
            color: theme.text, marginTop: 6, marginBottom: 12,
          }}>
            Sign in to{'\n'}
            <Text style={{ fontFamily: theme.fontDisplaySemi, color: theme.accent }}>your binder.</Text>
          </Text>
          <Text style={{
            color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 32,
            fontFamily: theme.fontUI,
          }}>
            Track the cards you own, the ones you're hunting, and what your collection is worth — at today's European market prices.
          </Text>
        </Animated.View>

        <Animated.View entering={enter(2)}>
          <Field label="Email" value={email} onChange={setEmail}
            autoCapitalize="none" keyboardType="email-address" />
          <View style={{ height: 16 }} />
          <Field label="Password" value={password} onChange={setPassword}
            secureTextEntry />

          {mode === 'signin' && (
            <Pressable onPress={onForgotPassword} disabled={busy} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 12 }}>
              <Text style={{
                color: theme.textDim, fontSize: 12,
                fontFamily: theme.fontUI,
              }}>Forgot password?</Text>
            </Pressable>
          )}

          <Button
            label={mode === 'signin' ? 'Enter the vault' : 'Create account'}
            icon="arrow-right"
            onPress={submit}
            disabled={busy}
            style={{ marginTop: 24 }}
          />
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          <Text style={{
            color: theme.textDim, textAlign: 'center', fontSize: 13,
            fontFamily: theme.fontUI, marginBottom: 8,
          }}>
            {mode === 'signin' ? 'New collector? ' : 'Have an account? '}
            <Text style={{ color: theme.accent, fontFamily: theme.fontUIBold }}>
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </Text>
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({
  label, value, onChange, ...rest
}: any) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Eyebrow style={{ marginBottom: 8 }}>{label}</Eyebrow>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={theme.textMute}
        style={{
          backgroundColor: theme.glass,
          borderWidth: 1,
          borderColor: focused ? theme.borderStrong : theme.hairline,
          borderRadius: theme.radius,
          paddingHorizontal: 16, paddingVertical: 14,
          fontSize: 15,
          color: theme.text,
          fontFamily: theme.fontUI,
          boxShadow: focused ? theme.shadowGold : theme.shadowInner,
        }}
        {...rest}
      />
    </View>
  );
}
