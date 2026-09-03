// Profile — email, big stats, username editing, sign out.

import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Platform, Modal, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSession } from '@/lib/auth';
import {
  useCollection, useMyProfile, useSetUsername,
  useFriends, useIncomingRequests,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { SheetCard } from '@/components/SheetCard';
import { Button, GoldFill } from '@/components/ui';
import { theme } from '@/lib/theme';

export default function Profile() {
  const { session, signOut } = useSession();
  const { data: rows = [] } = useCollection();
  const { data: profile } = useMyProfile();
  const setUsername = useSetUsername();
  const { data: friends = [] } = useFriends();
  const { data: incoming = [] } = useIncomingRequests();
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
          <View style={{
            width: 74, height: 74, borderRadius: 37,
            borderWidth: 1, borderColor: theme.borderStrong,
            backgroundColor: theme.shell,
            padding: 4,
            alignItems: 'center', justifyContent: 'center',
            boxShadow: theme.shadowGold,
          }}>
            <View style={{
              width: '100%', height: '100%', borderRadius: 999,
              overflow: 'hidden',
              alignItems: 'center', justifyContent: 'center',
              boxShadow: theme.shadowInner,
            }}>
              <GoldFill />
              <Text style={{
                fontFamily: theme.fontDisplaySemi,
                fontSize: 30, color: theme.accentText,
              }}>{initial}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: theme.fontDisplaySemi,
              fontSize: 24, color: theme.text, lineHeight: 32,
            }}>
              {username ? `@${username}` : email.split('@')[0]}
            </Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>{email}</Text>
          </View>
        </View>

        <View style={{ marginTop: 24, flexDirection: 'row', gap: 10 }}>
          <BigStat label="Cards owned" val={String(have.length)} />
          <BigStat label="Collection · EU" val={`€${value.toFixed(0)}`} />
        </View>

        <Eyebrow style={{ marginTop: 30 }}>Account</Eyebrow>
        <View style={{
          marginTop: 10,
          backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.hairline,
          borderRadius: theme.radiusLg,
          boxShadow: theme.shadowInner,
          overflow: 'hidden',
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

        {/* Friends preview; the full list and requests live at /friends. */}
        {(friends.length > 0 || incoming.length > 0) && (() => {
          const PREVIEW_N = 3;
          const previewFriends = friends.slice(0, PREVIEW_N);
          const overflow = Math.max(0, friends.length - PREVIEW_N);
          return (
            <>
              <View style={{
                flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
                marginTop: 28,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Eyebrow>Friends</Eyebrow>
                  {incoming.length > 0 && (
                    <Text style={{
                      color: theme.accent, fontFamily: theme.fontMono, fontSize: 10,
                      letterSpacing: 1, textTransform: 'uppercase',
                    }}>
                      ({incoming.length})
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{
                    color: theme.textDim, fontFamily: theme.fontMono, fontSize: 11,
                    letterSpacing: 0.5,
                  }}>
                    {friends.length > 50 ? '50+' : friends.length}
                  </Text>
                  <Text style={{ color: theme.textMute, fontSize: 11 }}>·</Text>
                  <Pressable onPress={() => router.push('/friends')} hitSlop={8}>
                    <Text style={{
                      color: theme.accent, fontFamily: theme.fontUIBold, fontSize: 11,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                    }}>See all</Text>
                  </Pressable>
                </View>
              </View>

              {friends.length > 0 && (
                <View style={{
                  marginTop: 10,
                  backgroundColor: theme.surface,
                  borderWidth: 1, borderColor: theme.hairline,
                  borderRadius: theme.radiusLg,
                  boxShadow: theme.shadowInner,
                  overflow: 'hidden',
                }}>
                  {previewFriends.map((f, i) => (
                    <Pressable
                      key={f.friendship.id}
                      onPress={() => f.profile.username && router.push(`/u/${f.profile.username}`)}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', gap: 12,
                        padding: 13,
                        backgroundColor: pressed ? theme.accentFaint : 'transparent',
                        borderBottomWidth: i === previewFriends.length - 1 && overflow === 0 ? 0 : 1,
                        borderBottomColor: theme.hairline,
                      })}>
                      <View style={{
                        width: 34, height: 34, borderRadius: 17,
                        overflow: 'hidden',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <GoldFill />
                        <Text style={{
                          fontFamily: theme.fontDisplaySemi,
                          fontSize: 15, color: theme.accentText,
                        }}>{(f.profile.username?.[0] ?? '?').toUpperCase()}</Text>
                      </View>
                      <Text style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: theme.fontUIBold }}>
                        @{f.profile.username ?? 'unknown'}
                      </Text>
                      <Feather name="chevron-right" size={16} color={theme.textMute} />
                    </Pressable>
                  ))}
                  {overflow > 0 && (
                    <Pressable
                      onPress={() => router.push('/friends')}
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: 12,
                      }}>
                      <Text style={{
                        color: theme.accent, fontFamily: theme.fontUIBold, fontSize: 11,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                      }}>
                        + {overflow} more
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          );
        })()}

        <Eyebrow style={{ marginTop: 30 }}>Find a trainer</Eyebrow>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginTop: 10,
        }}>
          <View style={{
            flex: 1,
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16,
            backgroundColor: theme.glass,
            borderWidth: 1, borderColor: theme.hairline,
            borderRadius: theme.pill,
            boxShadow: theme.shadowInner,
          }}>
            <Feather name="at-sign" size={14} color={theme.textDim} />
            <TextInput
              value={findDraft}
              // No transform in onChangeText: re-setting the controlled value
              // races the Android IME and duplicates characters. Lowercased at submit.
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
          <Button label="Visit" small onPress={visitTrainer} />
        </View>
        <Text style={{
          color: theme.textDim, fontSize: 11, marginTop: 8, lineHeight: 16,
        }}>
          Open another trainer&apos;s profile to browse their public binders.
        </Text>

        <Pressable
          onPress={confirmSignOut}
          style={({ pressed }) => ({
            marginTop: 30,
            borderWidth: 1, borderColor: theme.hairline,
            borderRadius: theme.pill,
            padding: 14,
            backgroundColor: pressed ? theme.statusReallySoft : 'transparent',
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}>
          <Text style={{
            color: theme.statusReally, fontSize: 13, fontFamily: theme.fontUIBold,
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
            flex: 1, backgroundColor: theme.scrim,
            justifyContent: 'center', alignItems: 'center', padding: 24,
          }}
        >
          <SheetCard
            key={editingUsername ? 'open' : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.hairline,
              borderRadius: theme.radiusXl,
              padding: 24,
              boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
            }}
          >
            <Eyebrow>Username</Eyebrow>
            <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: theme.fontUI, marginTop: 6 }}>
              3-24 chars: lowercase a-z, 0-9, underscore, dash.
            </Text>
            <TextInput
              value={draft}
              // Same Android IME quirk as findDraft: lowercase at save, not per keystroke.
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="trainer123"
              placeholderTextColor={theme.textMute}
              style={{
                backgroundColor: theme.glass,
                borderWidth: 1, borderColor: theme.borderStrong,
                borderRadius: theme.radius,
                paddingHorizontal: 16, paddingVertical: 13, marginTop: 16,
                fontSize: 15, color: theme.text,
                fontFamily: theme.fontMono,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setEditingUsername(false)}
                style={{ flex: 1 }}
              />
              <Button
                label="Save"
                onPress={saveUsername}
                disabled={setUsername.isPending}
                style={{ flex: 1 }}
              />
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
      backgroundColor: theme.glass,
      borderWidth: 1, borderColor: theme.hairline,
      borderRadius: theme.radius,
      padding: 16,
      boxShadow: theme.shadowInner,
    }}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={{
        fontFamily: theme.fontMono,
        fontSize: 26, color: theme.text, marginTop: 8,
        letterSpacing: -0.5,
      }}>{val}</Text>
    </View>
  );
}

function Row({
  label, value, last, accent,
}: { label: string; value: string; last?: boolean; accent?: boolean }) {
  return (
    <View style={{
      paddingHorizontal: 16, paddingVertical: 15,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.hairline,
    }}>
      <Text style={{ color: theme.text, fontSize: 14, fontFamily: theme.fontUI }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{
          color: accent ? theme.accent : theme.textDim,
          fontSize: 13, fontFamily: theme.fontMono,
        }}>{value}</Text>
        <Feather name="chevron-right" size={14} color={accent ? theme.accent : theme.textMute} />
      </View>
    </View>
  );
}
