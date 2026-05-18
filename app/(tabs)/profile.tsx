// Profile — email, big stats, sign out.

import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSession } from '@/lib/auth';
import { useCollection } from '@/lib/queries';
import { theme } from '@/lib/theme';

export default function Profile() {
  const { session, signOut } = useSession();
  const { data: rows = [] } = useCollection();

  const have = rows.filter((r) => r.status === 'have');
  const value = have.reduce((s, r) => s + (r.last_price_eur ?? 0), 0);
  const email = session?.user.email ?? 'unknown';
  const initial = (email[0] ?? '?').toUpperCase();

  const confirmSignOut = () => {
    Alert.alert('Sign out?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
        <Eyebrow>Trainer profile</Eyebrow>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }}>
          <View style={{
            width: 66, height: 66, borderRadius: 33,
            backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 28, color: theme.accentText,
            }}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 22, color: theme.text,
            }}>{email.split('@')[0]}</Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>{email}</Text>
          </View>
        </View>

        <View style={{ marginTop: 22, flexDirection: 'row', gap: 10 }}>
          <BigStat label="Cards owned" val={String(have.length)} />
          <BigStat label="Collection · EU" val={`€${value.toFixed(0)}`} />
        </View>

        <Eyebrow style={{ marginTop: 28 }}>Account</Eyebrow>
        <View style={{
          marginTop: 10,
          backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.border,
          borderRadius: theme.radius,
        }}>
          <Row label="Price region" value="EU · €" last />
        </View>

        <Pressable
          onPress={confirmSignOut}
          style={{
            marginTop: 28,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: theme.radius,
            padding: 14,
          }}>
          <Text style={{
            color: theme.statusReally, fontSize: 13, fontWeight: '600',
            textAlign: 'center', letterSpacing: 0.3,
          }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function BigStat({ label, val }: { label: string; val: string }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border,
      borderRadius: theme.radius,
      padding: 14,
    }}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={{
        fontFamily: theme.fontMono,
        fontSize: 24, color: theme.text, marginTop: 4,
      }}>{val}</Text>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={{
      padding: 14,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.border,
    }}>
      <Text style={{ color: theme.text, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.textDim, fontSize: 13, fontFamily: theme.fontMono }}>{value} ›</Text>
    </View>
  );
}
