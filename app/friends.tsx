// Friends screen: friends list plus incoming/outgoing requests.

import { View, Text, Pressable, RefreshControl, FlatList } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import {
  useFriends, useIncomingRequests, useOutgoingRequests,
  useAcceptFriendRequest, useDeleteFriendship,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { Button, GoldFill, IconDisc } from '@/components/ui';
import { theme } from '@/lib/theme';

type Tab = 'friends' | 'requests';

export default function Friends() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: friends = [], isLoading } = useFriends();
  const { data: incoming = [] } = useIncomingRequests();
  const { data: outgoing = [] } = useOutgoingRequests();
  const acceptRequest = useAcceptFriendRequest();
  const deleteFriendship = useDeleteFriendship();
  const toast = useToast();
  const confirm = useConfirm();
  const [refreshing, setRefreshing] = useState(false);

  // Open on Requests when there are no friends but a pending incoming request.
  const [tab, setTab] = useState<Tab>(() =>
    friends.length === 0 && incoming.length > 0 ? 'requests' : 'friends',
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.refetchQueries({ queryKey: ['friendships'] });
    setRefreshing(false);
  };

  const onAccept = async (friendshipId: string, username: string | null) => {
    try {
      await acceptRequest.mutateAsync(friendshipId);
      toast.success(`You and @${username ?? 'them'} are now friends`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not accept');
    }
  };
  const onDecline = async (friendshipId: string) => {
    try {
      await deleteFriendship.mutateAsync(friendshipId);
      toast.success('Request declined');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not decline');
    }
  };
  const onCancelOutgoing = async (friendshipId: string, username: string | null) => {
    const ok = await confirm({
      title: `Cancel request to @${username ?? 'them'}?`,
      confirmText: 'Cancel request',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFriendship.mutateAsync(friendshipId);
      toast.success('Request cancelled');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not cancel');
    }
  };

  const Header = (
    <View style={{ paddingTop: 24, paddingBottom: 16 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <IconDisc name="chevron-left" onPress={() => router.back()} />
      </View>
      <Eyebrow style={{ marginTop: 16 }}>Your circle</Eyebrow>
      <Text style={{
        fontFamily: theme.fontDisplaySemi,
        fontSize: 28, color: theme.text, marginTop: 4, lineHeight: 36,
      }}>Friends</Text>

      <View style={{
        flexDirection: 'row',
        marginTop: 18,
        borderBottomWidth: 1, borderBottomColor: theme.hairline,
      }}>
        <TabButton
          label="Friends"
          count={friends.length}
          active={tab === 'friends'}
          onPress={() => setTab('friends')}
        />
        <TabButton
          label="Requests"
          count={incoming.length + outgoing.length}
          highlight={incoming.length > 0}
          active={tab === 'requests'}
          onPress={() => setTab('requests')}
        />
      </View>
    </View>
  );

  if (tab === 'requests') {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <FlatList
          data={[]}
          keyExtractor={() => ''}
          renderItem={null as any}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
          ListHeaderComponent={
            <View>
              {Header}
              {incoming.length === 0 && outgoing.length === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{
                    color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 20,
                  }}>
                    No pending requests.
                  </Text>
                </View>
              )}

              {incoming.length > 0 && (
                <View style={{ gap: 8, marginBottom: 24 }}>
                  <Text style={{
                    color: theme.accent, fontFamily: theme.fontMono, fontSize: 10,
                    letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    Incoming · {incoming.length}
                  </Text>
                  {incoming.map((req) => (
                    <View key={req.friendship.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      padding: 12,
                      backgroundColor: theme.surface,
                      borderWidth: 1, borderColor: theme.borderStrong,
                      borderRadius: theme.radiusLg,
                      boxShadow: theme.shadowInner,
                    }}>
                      <Avatar letter={(req.profile.username?.[0] ?? '?').toUpperCase()} size={36} />
                      <Pressable
                        onPress={() => req.profile.username && router.push(`/u/${req.profile.username}`)}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Text style={{ color: theme.text, fontSize: 14, fontFamily: theme.fontUIBold }}>
                          @{req.profile.username ?? 'unknown'}
                        </Text>
                        <Text style={{
                          color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
                          marginTop: 2, letterSpacing: 0.8, textTransform: 'uppercase',
                        }}>
                          Wants to be friends
                        </Text>
                      </Pressable>
                      <Button
                        label="Accept"
                        small
                        onPress={() => onAccept(req.friendship.id, req.profile.username)}
                      />
                      <IconDisc
                        name="x"
                        size={32}
                        onPress={() => onDecline(req.friendship.id)}
                      />
                    </View>
                  ))}
                </View>
              )}

              {outgoing.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{
                    color: theme.textDim, fontFamily: theme.fontMono, fontSize: 10,
                    letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    Outgoing · {outgoing.length}
                  </Text>
                  {outgoing.map((req) => (
                    <View key={req.friendship.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      padding: 12,
                      backgroundColor: theme.surface,
                      borderWidth: 1, borderColor: theme.hairline,
                      borderRadius: theme.radiusLg,
                      boxShadow: theme.shadowInner,
                    }}>
                      <Avatar letter={(req.profile.username?.[0] ?? '?').toUpperCase()} size={36} dim />
                      <Pressable
                        onPress={() => req.profile.username && router.push(`/u/${req.profile.username}`)}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Text style={{ color: theme.text, fontSize: 14, fontFamily: theme.fontUIBold }}>
                          @{req.profile.username ?? 'unknown'}
                        </Text>
                        <Text style={{
                          color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
                          marginTop: 2, letterSpacing: 0.8, textTransform: 'uppercase',
                        }}>
                          Awaiting reply
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onCancelOutgoing(req.friendship.id, req.profile.username)}
                        hitSlop={10}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12, paddingVertical: 7,
                          borderRadius: theme.pill,
                          borderWidth: 1, borderColor: theme.hairline,
                          backgroundColor: pressed ? theme.glassStrong : theme.glass,
                        })}
                      >
                        <Text style={{
                          color: theme.textDim, fontSize: 10,
                          fontFamily: theme.fontUIBold, letterSpacing: 0.5,
                          textTransform: 'uppercase',
                        }}>Cancel</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
        />
      </Screen>
    );
  }

  // friends tab
  return (
    <Screen edges={['top', 'left', 'right']}>
      <FlatList
        data={friends}
        keyExtractor={(f) => f.friendship.id}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        ListHeaderComponent={Header}
        ListEmptyComponent={
          !isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{
                color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 20,
              }}>
                No friends yet.{'\n'}
                Find a trainer in your profile and tap &ldquo;Add friend&rdquo; on their page.
              </Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => item.profile.username && router.push(`/u/${item.profile.username}`)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 12,
              padding: 14,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.hairline,
              borderRadius: theme.radiusLg,
              boxShadow: theme.shadowInner,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}>
            <Avatar letter={(item.profile.username?.[0] ?? '?').toUpperCase()} size={40} />
            <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontFamily: theme.fontUIBold }}>
              @{item.profile.username ?? 'unknown'}
            </Text>
            <Feather name="chevron-right" size={16} color={theme.textMute} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

function TabButton({
  label, count, active, highlight, onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  highlight?: boolean;
  onPress: () => void;
}) {
  // highlight tints the count badge even while the tab is inactive.
  const countColor = highlight ? theme.accent
    : active ? theme.text
    : theme.textMute;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: active ? theme.accent : 'transparent',
        marginBottom: -1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{
          fontFamily: theme.fontUIBold, fontSize: 12,
          letterSpacing: 0.8, textTransform: 'uppercase',
          color: active ? theme.text : theme.textDim,
        }}>{label}</Text>
        {count > 0 && (
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 11,
            color: countColor,
          }}>{count}</Text>
        )}
      </View>
    </Pressable>
  );
}

function Avatar({ letter, size, dim = false }: { letter: string; size: number; dim?: boolean }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: dim ? theme.surface2 : undefined,
      borderWidth: dim ? 1 : 0,
      borderColor: theme.hairline,
      overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {!dim && <GoldFill />}
      <Text style={{
        fontFamily: theme.fontDisplaySemi,
        fontSize: size * 0.42, color: dim ? theme.textDim : theme.accentText,
      }}>{letter}</Text>
    </View>
  );
}
