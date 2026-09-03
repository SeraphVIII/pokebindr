// Public profile page. Public binders show for anyone; friends-only binders
// appear only when RLS grants the viewer access.

import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Button, GoldFill, IconDisc } from '@/components/ui';
import {
  usePublicProfile,
  useUserIdByUsername,
  useFriendshipWith,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useDeleteFriendship,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { theme } from '@/lib/theme';
import type { Binder } from '@/lib/types';

export default function PublicProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { data, isLoading } = usePublicProfile(username);
  const { data: targetUserId } = useUserIdByUsername(username);
  const { data: friendship } = useFriendshipWith(targetUserId ?? undefined);
  const sendRequest = useSendFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const deleteFriendship = useDeleteFriendship();
  const toast = useToast();
  const confirm = useConfirm();

  if (isLoading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  if (!data?.profile) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}>
            No such trainer
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 13, textAlign: 'center' }}>
            @{username} doesn&apos;t exist or hasn&apos;t set a username yet.
          </Text>
        </View>
      </Screen>
    );
  }

  const onSend = async () => {
    if (!targetUserId) return;
    try {
      await sendRequest.mutateAsync(targetUserId);
      toast.success(`Friend request sent to @${username}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not send request');
    }
  };
  const onAccept = async () => {
    if (!friendship?.row) return;
    try {
      await acceptRequest.mutateAsync(friendship.row.id);
      toast.success(`You and @${username} are now friends`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not accept request');
    }
  };
  const onDecline = async () => {
    if (!friendship?.row) return;
    try {
      await deleteFriendship.mutateAsync(friendship.row.id);
      toast.success('Request declined');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not decline request');
    }
  };
  const onCancel = async () => {
    if (!friendship?.row) return;
    try {
      await deleteFriendship.mutateAsync(friendship.row.id);
      toast.success('Request cancelled');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not cancel');
    }
  };
  const onUnfriend = async () => {
    if (!friendship?.row) return;
    const ok = await confirm({
      title: `Unfriend @${username}?`,
      message: 'You\'ll stop seeing their friends-only binders.',
      confirmText: 'Unfriend',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFriendship.mutateAsync(friendship.row.id);
      toast.success(`Unfriended @${username}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not unfriend');
    }
  };

  const state = friendship?.state ?? 'none';

  const publicBinders = data.binders.filter((b) => b.visibility === 'public');
  const friendsBinders = data.binders.filter((b) => b.visibility === 'friends');

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Eyebrow>Trainer profile</Eyebrow>
          <IconDisc name="chevron-left" onPress={() => router.back()} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }}>
          <View style={{
            width: 68, height: 68, borderRadius: 34,
            borderWidth: 1, borderColor: theme.borderStrong,
            backgroundColor: theme.shell,
            padding: 4,
            boxShadow: theme.shadowGold,
          }}>
            <View style={{
              width: '100%', height: '100%', borderRadius: 999,
              overflow: 'hidden',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <GoldFill />
              <Text style={{
                fontFamily: theme.fontDisplaySemi,
                fontSize: 26, color: theme.accentText,
              }}>{(username?.[0] ?? '?').toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: theme.fontDisplaySemi,
              fontSize: 22, color: theme.text,
            }}>@{username}</Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>
              {data.binders.length} {data.binders.length === 1 ? 'binder' : 'binders'} visible
            </Text>
          </View>
        </View>

        {state !== 'self' && (
          <FriendButton
            state={state}
            pending={
              sendRequest.isPending
              || acceptRequest.isPending
              || deleteFriendship.isPending
            }
            onSend={onSend}
            onAccept={onAccept}
            onDecline={onDecline}
            onCancel={onCancel}
            onUnfriend={onUnfriend}
          />
        )}

        {publicBinders.length > 0 && (
          <>
            <Eyebrow style={{ marginTop: 28 }}>Public binders</Eyebrow>
            <View style={{ marginTop: 12, gap: 10 }}>
              {publicBinders.map((b) => (
                <BinderCard
                  key={b.id}
                  binder={b}
                  onPress={() => router.push(`/u/${username}/binder/${b.id}`)}
                />
              ))}
            </View>
          </>
        )}

        {friendsBinders.length > 0 && (
          <>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              marginTop: 28,
            }}>
              <Feather name="users" size={12} color={theme.accent} />
              <Eyebrow>Friends-only binders</Eyebrow>
            </View>
            <View style={{ marginTop: 12, gap: 10 }}>
              {friendsBinders.map((b) => (
                <BinderCard
                  key={b.id}
                  binder={b}
                  onPress={() => router.push(`/u/${username}/binder/${b.id}`)}
                />
              ))}
            </View>
          </>
        )}

        {data.binders.length === 0 && (
          <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 28 }}>
            {state === 'friends'
              ? 'No binders to show.'
              : 'No public binders yet.'}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

function FriendButton({
  state, pending, onSend, onAccept, onDecline, onCancel, onUnfriend,
}: {
  state: 'self' | 'none' | 'outgoing-pending' | 'incoming-pending' | 'friends';
  pending: boolean;
  onSend: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onUnfriend: () => void;
}) {
  if (state === 'none') {
    return (
      <Button
        label="Add friend"
        icon="user-plus"
        onPress={onSend}
        disabled={pending}
        style={{ marginTop: 18 }}
      />
    );
  }
  if (state === 'outgoing-pending') {
    return (
      <View style={{ marginTop: 18, flexDirection: 'row', gap: 10 }}>
        <View style={{
          flex: 1, padding: 14, borderRadius: theme.pill,
          borderWidth: 1, borderColor: theme.hairline,
          backgroundColor: theme.glass,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Feather name="clock" size={13} color={theme.textDim} />
          <Text style={{
            color: theme.textDim, fontSize: 12,
            fontFamily: theme.fontUIBold, letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>Request sent</Text>
        </View>
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={pending} />
      </View>
    );
  }
  if (state === 'incoming-pending') {
    return (
      <View style={{ marginTop: 18, flexDirection: 'row', gap: 10 }}>
        <Button
          label="Accept"
          icon="check"
          onPress={onAccept}
          disabled={pending}
          style={{ flex: 1 }}
        />
        <Button label="Decline" variant="ghost" onPress={onDecline} disabled={pending} />
      </View>
    );
  }
  // friends
  return (
    <Pressable
      onPress={onUnfriend}
      disabled={pending}
      style={({ pressed }) => ({
        marginTop: 18, padding: 14, borderRadius: theme.pill,
        borderWidth: 1, borderColor: theme.borderStrong,
        backgroundColor: pressed ? theme.accentSoft : theme.glass,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: pending ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <Feather name="user-check" size={14} color={theme.accent} />
      <Text style={{
        color: theme.accent, fontSize: 13,
        fontFamily: theme.fontUIBold, letterSpacing: 0.5,
        textTransform: 'uppercase',
      }}>Friends</Text>
    </Pressable>
  );
}

function BinderCard({ binder, onPress }: { binder: Binder; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 16,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radiusLg,
        boxShadow: theme.shadowInner,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <View style={{
        width: 44, height: 44, borderRadius: 12,
        backgroundColor: theme.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Feather name="grid" size={20} color={theme.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 18, color: theme.text,
        }} numberOfLines={1}>{binder.name}</Text>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, marginTop: 4,
        }}>
          {binder.grid_cols}×{binder.grid_rows}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Feather name="heart" size={13} color={theme.textDim} />
        <Text style={{
          color: theme.textDim, fontFamily: theme.fontMono, fontSize: 12,
        }}>{binder.likes_count}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.textMute} />
    </Pressable>
  );
}
