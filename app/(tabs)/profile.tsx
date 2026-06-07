// Profile — email, big stats, username editing, sign out.

import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Platform, Modal, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSession } from '@/lib/auth';
import { useCollection, useMyProfile, useSetUsername } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { SheetCard } from '@/components/SheetCard';
import { theme } from '@/lib/theme';

export default function Profile() {
  const { session, signOut } = useSession();
  const { data: rows = [] } = useCollection();
  const { data: profile } = useMyProfile();
  const setUsername = useSetUsername();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [findDraft, setFindDraft] = useState('');

  const visitTrainer = () => {
    const v = findDraft.trim().toLowerCase().replace(/^@/, '');
    if (!v) {
      toast.error('Type a username first');
      return;
    }
    if (!/^[a-z0-9_-]{3,24}$/.test(v)) {
      toast.error('3-24 chars: a-z, 0-9, _ or -');
      return;
    }
    setFindDraft('');
    router.push(`/u/${v}`);
  };

  const have = rows.filter((r) => r.status === 'have');
  const value = have.reduce((s, r) => s + (r.last_price_eur ?? 0), 0);
  const email = session?.user.email ?? 'unknown';
  const initial = (profile?.username?.[0] ?? email[0] ?? '?').toUpperCase();
  const username = profile?.username ?? null;

  const [editingUsername, setEditingUsername] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(username ?? ''); }, [username]);

  const saveUsername = async () => {
    const v = draft.trim().toLowerCase();
    if (!v) {
      toast.error('Username can\'t be empty');
      return;
    }
    if (!/^[a-z0-9_-]{3,24}$/.test(v)) {
      toast.error('3-24 chars: a-z, 0-9, _ or -');
      return;
    }
    try {
      await setUsername.mutateAsync(v);
      setEditingUsername(false);
      toast.success('Username saved');
    } catch (e: any) {
      // Postgres unique-violation surfaces as code 23505 in Supabase errors.
      const msg = e?.message ?? '';
      if (msg.includes('duplicate') || msg.includes('23505')) {
        toast.error('That username is taken');
      } else {
        toast.error(msg || 'Could not save username');
      }
    }
  };

  const confirmSignOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      confirmText: 'Sign out',
      destructive: true,
    });
    if (ok) signOut();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
        <Eyebrow>Trainer profile</Eyebrow>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }}>
          {/* Signet/medallion: an outer hairline ring + an inner gold disk, set
              one pixel apart so it reads as a coin rather than a flat circle. */}
          <View style={{
            width: 70, height: 70, borderRadius: 35,
            borderWidth: 1, borderColor: theme.borderStrong,
            padding: 3,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <View style={{
              width: '100%', height: '100%', borderRadius: 999,
              backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{
                fontFamily: theme.fontDisplay,
                fontSize: 28, color: theme.accentText,
              }}>{initial}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 22, color: theme.text, lineHeight: 30,
            }}>
              {username ? `@${username}` : email.split('@')[0]}
            </Text>
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
          <Pressable onPress={() => setEditingUsername(true)}>
            <Row
              label="Username"
              value={username ? `@${username}` : 'Set username'}
              accent={!username}
            />
          </Pressable>
          <Row label="Price region" value="EU · €" last />
        </View>

        {!username && (
          <Text style={{
            color: theme.textDim, fontSize: 11, marginTop: 8, lineHeight: 16,
          }}>
            A username lets you list public binders at /u/&lt;name&gt;.
          </Text>
        )}

        <Eyebrow style={{ marginTop: 28 }}>Find a trainer</Eyebrow>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          marginTop: 10,
        }}>
          <View style={{
            flex: 1,
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 12,
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: theme.radius,
          }}>
            <Feather name="at-sign" size={14} color={theme.textDim} />
            <TextInput
              value={findDraft}
              // Don't transform in onChangeText — re-setting the controlled value
              // races with the Android IME and duplicates characters on some
              // keyboards (the "type 'a', see 'aaa'" bug). autoCapitalize="none"
              // already keeps the keyboard lowercase, and visitTrainer lowercases
              // the value when it's used.
              onChangeText={setFindDraft}
              onSubmitEditing={visitTrainer}
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="username"
              placeholderTextColor={theme.textMute}
              style={{
                flex: 1,
                paddingVertical: 12,
                fontSize: 14, color: theme.text,
                fontFamily: theme.fontMono,
              }}
            />
          </View>
          <Pressable
            onPress={visitTrainer}
            style={{
              paddingHorizontal: 16, paddingVertical: 12,
              borderRadius: theme.radius,
              backgroundColor: theme.accent,
            }}>
            <Text style={{
              color: theme.accentText, fontSize: 12,
              fontFamily: theme.fontUIBold, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>Visit</Text>
          </Pressable>
        </View>
        <Text style={{
          color: theme.textDim, fontSize: 11, marginTop: 8, lineHeight: 16,
        }}>
          Open another trainer&apos;s profile to browse their public binders.
        </Text>

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

      <Modal
        visible={editingUsername}
        transparent
        animationType="none"
        onRequestClose={() => setEditingUsername(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center', alignItems: 'center', padding: 24,
          }}
        >
          <SheetCard
            key={editingUsername ? 'open' : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.borderStrong,
              borderRadius: theme.radius * 1.5,
              padding: 20,
            }}
          >
            <Eyebrow>Username</Eyebrow>
            <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>
              3-24 chars: lowercase a-z, 0-9, underscore, dash.
            </Text>
            <TextInput
              value={draft}
              // See the matching note on findDraft — saveUsername lowercases on
              // save, so per-keystroke transform is redundant AND triggers the
              // Android character-duplication bug.
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="trainer123"
              placeholderTextColor={theme.textMute}
              style={{
                backgroundColor: theme.surface2,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                padding: 12, marginTop: 14,
                fontSize: 15, color: theme.text,
                fontFamily: theme.fontMono,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Pressable
                onPress={() => setEditingUsername(false)}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  borderWidth: 1, borderColor: theme.border,
                  alignItems: 'center',
                }}>
                <Text style={{ color: theme.textDim, fontFamily: theme.fontUIBold, fontSize: 12, textTransform: 'uppercase' }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveUsername}
                disabled={setUsername.isPending}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  backgroundColor: theme.accent,
                  alignItems: 'center',
                  opacity: setUsername.isPending ? 0.6 : 1,
                }}>
                <Text style={{ color: theme.accentText, fontFamily: theme.fontUIBold, fontSize: 12, textTransform: 'uppercase' }}>
                  Save
                </Text>
              </Pressable>
            </View>
          </SheetCard>
        </KeyboardAvoidingView>
      </Modal>
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

function Row({
  label, value, last, accent,
}: { label: string; value: string; last?: boolean; accent?: boolean }) {
  return (
    <View style={{
      padding: 14,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.border,
    }}>
      <Text style={{ color: theme.text, fontSize: 14 }}>{label}</Text>
      <Text style={{
        color: accent ? theme.accent : theme.textDim,
        fontSize: 13, fontFamily: theme.fontMono,
      }}>{value} ›</Text>
    </View>
  );
}
