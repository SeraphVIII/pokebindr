// Binders list screen.

import { View, Text, Pressable, RefreshControl, Platform, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListRenderItemInfo,
} from 'react-native-reorderable-list';
import { runOnJS } from 'react-native-reanimated';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Button, IconDisc, Skeleton } from '@/components/ui';
import {
  useBinders, useCollection, useReorderBinders, useDeleteBinder, useRenameBinder,
  useExportBinder, useImportBinder, useDuplicateBinder,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { SheetCard } from '@/components/SheetCard';
import { exportBinderToFile, pickAndImportBinder } from '@/lib/pkbinderIO';
import { theme } from '@/lib/theme';
import type { Binder } from '@/lib/types';

export default function BindersList() {
  const { data: binders = [], isLoading } = useBinders();
  const { data: collection = [] } = useCollection();
  const reorder = useReorderBinders();
  const deleteBinder = useDeleteBinder();
  const renameBinder = useRenameBinder();
  const exportBinder = useExportBinder();
  const importBinder = useImportBinder();
  const duplicateBinder = useDuplicateBinder();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  // Pull-to-refresh is disabled while dragging; the drag's vertical movement
  // would otherwise trigger the RefreshControl spinner.
  const [dragging, setDragging] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Binder | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menuTarget, setMenuTarget] = useState<Binder | null>(null);
  const closeMenu = () => setMenuTarget(null);

  const openRename = (binder: Binder) => {
    setRenameTarget(binder);
    setRenameDraft(binder.name);
  };
  const closeRename = () => {
    setRenameTarget(null);
    setRenameDraft('');
  };
  const saveRename = async () => {
    const v = renameDraft.trim();
    if (!renameTarget) return;
    if (!v) {
      toast.error('Name can\'t be empty');
      return;
    }
    if (v === renameTarget.name) {
      closeRename();
      return;
    }
    try {
      await renameBinder.mutateAsync({ binderId: renameTarget.id, name: v });
      closeRename();
      toast.success('Renamed');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not rename binder');
    }
  };

  const onDuplicate = async (binder: Binder) => {
    try {
      const dup = await duplicateBinder.mutateAsync(binder.id);
      toast.success(`Duplicated as "${dup.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not duplicate binder');
    }
  };

  const onExport = async (binder: Binder) => {
    try {
      const { json, name } = await exportBinder.mutateAsync(binder.id);
      const filename = await exportBinderToFile(json, name);
      if (filename) toast.success('Saved to Downloads');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not export binder');
    }
  };

  const onImport = async () => {
    try {
      const parsed = await pickAndImportBinder();
      if (!parsed) return; // user cancelled
      const binder = await importBinder.mutateAsync({
        name: parsed.binder.name,
        cols: parsed.binder.cols,
        rows: parsed.binder.rows,
        pages: parsed.pages,
        cards: parsed.cards,
      });
      toast.success(`Imported "${binder.name}"`);
      router.push(`/binder/${binder.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not import binder');
    }
  };

  const confirmDeleteBinder = async (binder: Binder) => {
    const ok = await confirm({
      title: `Delete "${binder.name}"?`,
      message: 'All cards in this binder will be removed.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteBinder.mutateAsync(binder.id);
      toast.success(`Deleted "${binder.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete binder');
    }
  };
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.refetchQueries({ queryKey: ['binders'] }),
      qc.refetchQueries({ queryKey: ['collection'] }),
    ]);
    setRefreshing(false);
  };

  const countByBinder = collection.reduce<Record<string, number>>((acc, r) => {
    acc[r.binder_id] = (acc[r.binder_id] ?? 0) + 1;
    return acc;
  }, {});

  const Header = (
    // Sticky list header (stickyHeaderIndices=[0]). Opaque background so rows
    // scroll under it; horizontal padding comes from contentContainerStyle.
    <View style={{ paddingTop: 24, paddingBottom: 8, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Eyebrow>Your binders</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplaySemi,
            fontSize: 28, color: theme.text, marginTop: 4, lineHeight: 36,
          }}>Collection</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconDisc
            name="upload"
            iconSize={15}
            onPress={importBinder.isPending ? undefined : onImport}
            style={{ opacity: importBinder.isPending ? 0.5 : 1 }}
          />
          <Button label="New" small icon="plus" onPress={() => router.push('/binder/new')} />
        </View>
      </View>

      <View style={{ marginTop: 20, gap: 10 }}>
        <Pressable
          onPress={() => router.push('/collection')}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 14,
            padding: 16,
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.borderStrong,
            borderRadius: theme.radiusLg,
            boxShadow: theme.shadowInner,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}>
          <View style={{
            width: 44, height: 44, borderRadius: 12,
            backgroundColor: theme.accentSoft,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="list" size={20} color={theme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{
              fontFamily: theme.fontDisplaySemi,
              fontSize: 18, color: theme.text,
            }}>My Collection</Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>
              {collection.length} {collection.length === 1 ? 'card' : 'cards'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.textMute} />
        </Pressable>

        {binders.length > 0 && (
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 10,
            color: theme.textMute, letterSpacing: 1.5,
            textTransform: 'uppercase', marginTop: 16,
          }}>Binders</Text>
        )}

        {isLoading && (
          <View style={{ gap: 10 }}>
            <Skeleton height={78} radius={theme.radius} />
            <Skeleton height={78} radius={theme.radius} />
          </View>
        )}

        {!isLoading && binders.length === 0 && (
          <View style={{
            borderWidth: 1, borderColor: theme.hairline, borderStyle: 'dashed',
            backgroundColor: theme.glass,
            borderRadius: theme.radiusLg, padding: 28,
            alignItems: 'center',
          }}>
            <View style={{
              width: 52, height: 52, borderRadius: theme.pill,
              backgroundColor: theme.accentSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="grid" size={20} color={theme.accent} />
            </View>
            <Text style={{
              color: theme.text, fontSize: 19, textAlign: 'center',
              marginTop: 14, fontFamily: theme.fontDisplaySemi,
            }}>
              No binders yet
            </Text>
            <Text style={{
              color: theme.textDim, fontSize: 13, textAlign: 'center',
              marginTop: 6, fontFamily: theme.fontUI, lineHeight: 19,
            }}>
              Start a binder to give your cards a home.
            </Text>
            <Button
              label="Create your first"
              icon="arrow-right"
              onPress={() => router.push('/binder/new')}
              style={{ marginTop: 18 }}
            />
          </View>
        )}
      </View>
    </View>
  );

  const renderItem = ({ item }: ReorderableListRenderItemInfo<Binder>) => (
    <BinderRow
      binder={item}
      cards={countByBinder[item.id] ?? 0}
      onPress={() => router.push(`/binder/${item.id}`)}
      onOpenMenu={() => setMenuTarget(item)}
    />
  );

  return (
    <Screen>
      <ReorderableList
        data={binders}
        keyExtractor={(b) => b.id}
        renderItem={renderItem}
        style={{ flex: 1 }}
        ListHeaderComponent={Header}
        stickyHeaderIndices={[0]}
        // Gate pan activation behind a long-press so plain swipes stay with
        // the native scroller; the handle's long-press uses the same 200ms.
        panActivateAfterLongPress={200}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            enabled={!dragging}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        onDragStart={() => {
          'worklet';
          runOnJS(setDragging)(true);
        }}
        onDragEnd={() => {
          'worklet';
          runOnJS(setDragging)(false);
        }}
        onReorder={({ from, to }) => {
          if (from === to) return;
          const reordered = reorderItems(binders, from, to);
          reorder.mutate(reordered.map((b) => b.id));
        }}
      />

      <Modal
        visible={!!menuTarget}
        transparent
        animationType="none"
        onRequestClose={closeMenu}
      >
        <Pressable
          onPress={closeMenu}
          style={{
            flex: 1, backgroundColor: theme.scrim,
            justifyContent: 'flex-end',
          }}
        >
          {/* Stop propagation so taps on the sheet body don't close it. */}
          <Pressable onPress={() => {}}>
            <SheetCard
              key={menuTarget ? menuTarget.id : 'closed'}
              style={{
                marginHorizontal: 12, marginBottom: 16,
                backgroundColor: theme.surface,
                borderWidth: 1, borderColor: theme.hairline,
                borderRadius: theme.radiusXl,
                padding: 8,
                boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
              }}
            >
              <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}>
                <Eyebrow>{menuTarget?.name ?? ''}</Eyebrow>
              </View>
              <MenuAction
                icon="edit-2"
                label="Rename"
                onPress={() => {
                  const t = menuTarget;
                  closeMenu();
                  if (t) openRename(t);
                }}
              />
              {!menuTarget?.is_bulk && (
                <MenuAction
                  icon="copy"
                  label="Duplicate"
                  onPress={() => {
                    const t = menuTarget;
                    closeMenu();
                    if (t) onDuplicate(t);
                  }}
                />
              )}
              {!menuTarget?.is_bulk && (
                <MenuAction
                  icon="download"
                  label="Export as .pkbinder"
                  onPress={() => {
                    const t = menuTarget;
                    closeMenu();
                    if (t) onExport(t);
                  }}
                />
              )}
              <MenuAction
                icon="trash-2"
                label="Delete"
                destructive
                onPress={() => {
                  const t = menuTarget;
                  closeMenu();
                  if (t) confirmDeleteBinder(t);
                }}
              />
            </SheetCard>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!renameTarget}
        transparent
        animationType="none"
        onRequestClose={closeRename}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1, backgroundColor: theme.scrim,
            justifyContent: 'center', alignItems: 'center', padding: 24,
          }}
        >
          <SheetCard
            key={renameTarget ? renameTarget.id : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.hairline,
              borderRadius: theme.radiusXl,
              padding: 24,
              boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
            }}
          >
            <Eyebrow>Rename binder</Eyebrow>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              autoFocus
              selectTextOnFocus
              placeholder="Binder name"
              placeholderTextColor={theme.textMute}
              onSubmitEditing={saveRename}
              returnKeyType="done"
              style={{
                backgroundColor: theme.glass,
                borderWidth: 1, borderColor: theme.borderStrong,
                borderRadius: theme.radius,
                paddingHorizontal: 16, paddingVertical: 13, marginTop: 16,
                fontSize: 16, color: theme.text,
                fontFamily: theme.fontDisplay,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Button label="Cancel" variant="ghost" onPress={closeRename} style={{ flex: 1 }} />
              <Button label="Save" onPress={saveRename} disabled={renameBinder.isPending} style={{ flex: 1 }} />
            </View>
          </SheetCard>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function BinderRow({
  binder, cards, onPress, onOpenMenu,
}: {
  binder: Binder;
  cards: number;
  onPress: () => void;
  onOpenMenu: () => void;
}) {
  const drag = useReorderableDrag();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10,
        padding: 16,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: binder.is_bulk ? theme.borderStrong : theme.hairline,
        borderRadius: theme.radiusLg,
        borderStyle: binder.is_bulk ? 'dashed' : 'solid',
        boxShadow: theme.shadowInner,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <Pressable
        onLongPress={drag}
        // Matches panActivateAfterLongPress on the list, so the pan gesture
        // is active by the time the drag starts.
        delayLongPress={200}
        hitSlop={8}
        style={{
          paddingVertical: 6, paddingRight: 4, marginLeft: -4,
        }}>
        <Feather name="more-vertical" size={18} color={theme.textMute} />
      </Pressable>

      {binder.is_bulk ? (
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: theme.glass,
          borderWidth: 1, borderColor: theme.hairline,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="package" size={20} color={theme.accent} />
        </View>
      ) : (
        // mini grid icon
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: theme.glass,
          borderWidth: 1, borderColor: theme.borderStrong,
          flexDirection: 'row', flexWrap: 'wrap', gap: 2,
          alignItems: 'center', justifyContent: 'center',
          padding: 4,
        }}>
          {Array.from({ length: Math.min(9, binder.grid_cols * binder.grid_rows) }).map((_, i) => (
            <View key={i} style={{
              width: 8, height: 10, borderRadius: 2,
              backgroundColor: theme.accentSoft,
            }} />
          ))}
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 18, color: theme.text,
        }}>{binder.name}</Text>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, marginTop: 4,
        }}>
          {binder.is_bulk
            ? `${cards} ${cards === 1 ? 'card' : 'cards'} · loose`
            : `${binder.grid_cols}×${binder.grid_rows} · ${cards} ${cards === 1 ? 'card' : 'cards'}`}
        </Text>
      </View>

      <Pressable
        onPress={onOpenMenu}
        hitSlop={10}
        accessibilityLabel={`Actions for ${binder.name}`}
        style={({ pressed }) => ({
          width: 32, height: 32, borderRadius: theme.pill,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: pressed ? theme.glassStrong : theme.glass,
          marginRight: -4,
        })}
      >
        <Feather name="settings" size={15} color={theme.textDim} />
      </Pressable>
    </Pressable>
  );
}

function MenuAction({
  icon, label, onPress, destructive = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const tint = destructive ? theme.statusReally : theme.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 14,
        borderRadius: theme.radius,
        backgroundColor: pressed ? theme.surface2 : 'transparent',
      })}>
      <Feather name={icon} size={18} color={tint} />
      <Text style={{
        color: tint, fontSize: 15, fontFamily: theme.fontUI,
      }}>{label}</Text>
    </Pressable>
  );
}
