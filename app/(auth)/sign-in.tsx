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
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSession } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';

export default function SignIn() {
  const { signIn, signUp, resetPassword } = useSession();
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
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email.trim(), password);
      else {
        await signUp(email.trim(), password);
        toast.success('Check your inbox to confirm your email.');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Auth error');
    } finally {
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
    const target = email.trim();
    if (!target) {
      toast.info('Type your email above first, then tap Forgot password.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(target);
      toast.success('Reset link sent. Check your inbox.');
    } catch (e: any) {
      toast.error(e.message ?? 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ padding: 28 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ height: 36 }} />

        {/* monogram */}
        <View style={{
          width: 56, height: 56, borderRadius: 4,
          borderWidth: 1, borderColor: theme.borderStrong,
          backgroundColor: theme.surface,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 32,
        }}>
          <Text style={{
            fontFamily: theme.fontDisplaySemi, fontSize: 28,
            color: theme.accent,
          }}>P</Text>
        </View>

        <Eyebrow>Collector's archive</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 38, lineHeight: 42,
          color: theme.text, marginTop: 6, marginBottom: 12,
        }}>
          Sign in to{'\n'}
          <Text style={{ color: theme.accent }}>your binder.</Text>
        </Text>
        <Text style={{
          color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 32,
          fontFamily: theme.fontUI,
        }}>
          Track the cards you own, the ones you're hunting, and what your collection is worth — at today's European market prices.
        </Text>

        <Field label="Email" value={email} onChange={setEmail}
          autoCapitalize="none" keyboardType="email-address" />
        <View style={{ height: 16 }} />
        <Field label="Password" value={password} onChange={setPassword}
          secureTextEntry />

        {mode === 'signin' && (
          <Pressable onPress={onForgotPassword} disabled={busy} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 10 }}>
            <Text style={{
              color: theme.textDim, fontSize: 12,
              fontFamily: theme.fontUI,
            }}>Forgot password?</Text>
          </Pressable>
        )}

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
            color: theme.accentText, textAlign: 'center',
            fontFamily: theme.fontUIBold, fontSize: 14,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>{mode === 'signin' ? 'Enter the vault' : 'Create account'}</Text>
        </Pressable>

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
  return (
    <View>
      <Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>
      <TextInput
        value={value}
        onChangeText={onChange}
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
