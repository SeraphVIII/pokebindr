// Binders tab — list of all the user's binders. Tap one to enter it.
// Drag the left handle on a binder to reorder them; new order persists
// to the DB via useReorderBinders.

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
import {
  useBinders, useCollection, useReorderBinders, useDeleteBinder, useRenameBinder,
  useExportBinder, useImportBinder,
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
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  // While an item is being dragged, suppress pull-to-refresh — otherwise the
  // vertical drag triggers the RefreshControl spinner at the top of the list.
  const [dragging, setDragging] = useState(false);
  // Rename modal target: the binder currently being renamed (null when closed).
  // Keep the whole binder so we can show the original name for context.
  const [renameTarget, setRenameTarget] = useState<Binder | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // The binder whose actions menu is currently open (rename / export / delete).
  // Mutually exclusive with renameTarget — opening rename closes the menu.
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

  const onExport = async (binder: Binder) => {
    try {
      const { json, name } = await exportBinder.mutateAsync(binder.id);
      const filename = await exportBinderToFile(json, name);
      if (filename) toast.success(`Saved ${filename}`);
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

  // DraggableFlatList tracks the drag-preview order itself, and
  // useReorderBinders does an optimistic cache update on drop — so we
  // can render directly off `binders` without a local mirror.

  // Cheap client-side count per binder.
  const countByBinder = collection.reduce<Record<string, number>>((acc, r) => {
    acc[r.binder_id] = (acc[r.binder_id] ?? 0) + 1;
    return acc;
  }, {});

  const Header = (
    // No horizontal padding here — the FlatList's contentContainerStyle
    // already insets us 24px, so adding more would make the header
    // narrower than the binder rows below it.
    <View style={{ paddingTop: 24, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <View>
          <Eyebrow>Your binders</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 28, color: theme.text, marginTop: 4, lineHeight: 36,
          }}>Collection</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={onImport}
            disabled={importBinder.isPending}
            accessibilityLabel="Import a .pkbinder file"
            style={{
              width: 34, height: 34, borderRadius: theme.radius,
              borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center',
              opacity: importBinder.isPending ? 0.5 : 1,
            }}>
            <Feather name="upload" size={14} color={theme.textDim} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/binder/new')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: theme.radius,
              backgroundColor: theme.accent,
            }}>
            <Feather name="plus" size={14} color={theme.accentText} />
            <Text style={{
              color: theme.accentText, fontSize: 12,
              fontFamily: theme.fontUIBold, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>New</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: 20, gap: 10 }}>
        {/* Flat all-cards list — distinct from the grid binders below. */}
        <Pressable
          onPress={() => router.push('/collection')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 14,
            padding: 16,
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.borderStrong,
            borderRadius: theme.radius,
          }}>
          <View style={{
            width: 44, height: 44, borderRadius: 6,
            backgroundColor: theme.surface2,
            borderWidth: 1, borderColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="list" size={20} color={theme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 18, color: theme.text,
            }}>My Collection</Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>
              {collection.length} {collection.length === 1 ? 'card' : 'cards'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.textDim} />
        </Pressable>

        {binders.length > 0 && (
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 10,
            color: theme.textMute, letterSpacing: 1.5,
            textTransform: 'uppercase', marginTop: 16,
          }}>Binders</Text>
        )}

        {isLoading && (
          <Text style={{ color: theme.textDim }}>Loading…</Text>
        )}

        {!isLoading && binders.length === 0 && (
          <Pressable
            onPress={() => router.push('/binder/new')}
            style={{
              borderWidth: 1, borderColor: theme.borderStrong,
              backgroundColor: theme.surface,
              borderRadius: theme.radius, padding: 28,
              alignItems: 'center',
            }}>
            <Eyebrow>No binders yet</Eyebrow>
            <Text style={{
              color: theme.textDim, fontSize: 14, textAlign: 'center',
              marginTop: 8, fontFamily: theme.fontDisplay, lineHeight: 22,
            }}>
              Start a binder to begin your collection.
            </Text>
            <Text style={{
              color: theme.accent, fontSize: 12, marginTop: 10,
              fontFamily: theme.fontUIBold, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>
              Create your first one →
            </Text>
          </Pressable>
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
        ListHeaderComponent={Header}
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
            flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'flex-end',
          }}
        >
          {/* Stop propagation so taps on the sheet body don't close it. */}
          <Pressable onPress={() => {}}>
            <SheetCard
              key={menuTarget ? menuTarget.id : 'closed'}
              style={{
                marginHorizontal: 12, marginBottom: 12,
                backgroundColor: theme.surface,
                borderWidth: 1, borderColor: theme.borderStrong,
                borderRadius: theme.radius * 1.5,
                padding: 8,
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
            flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center', alignItems: 'center', padding: 24,
          }}
        >
          <SheetCard
            key={renameTarget ? renameTarget.id : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.borderStrong,
              borderRadius: theme.radius * 1.5,
              padding: 20,
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
                backgroundColor: theme.surface2,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                padding: 12, marginTop: 14,
                fontSize: 15, color: theme.text,
                fontFamily: theme.fontDisplay,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Pressable
                onPress={closeRename}
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
                onPress={saveRename}
                disabled={renameBinder.isPending}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  backgroundColor: theme.accent,
                  alignItems: 'center',
                  opacity: renameBinder.isPending ? 0.6 : 1,
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

function BinderRow({
  binder, cards, onPress, onOpenMenu,
}: {
  binder: Binder;
  cards: number;
  onPress: () => void;
  onOpenMenu: () => void;
}) {
  // ReorderableList provides the drag handle via a hook — call it once and
  // expose the returned function to the handle below. The library owns the
  // gesture; we only decide where to wire the trigger.
  const drag = useReorderableDrag();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        padding: 16,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: binder.is_bulk ? theme.borderStrong : theme.border,
        borderRadius: theme.radius,
        borderStyle: binder.is_bulk ? 'dashed' : 'solid',
      }}>
      <Pressable
        onLongPress={drag}
        delayLongPress={150}
        hitSlop={8}
        style={{
          paddingVertical: 6, paddingRight: 4, marginLeft: -4,
        }}>
        <Feather name="more-vertical" size={18} color={theme.textMute} />
      </Pressable>

      {binder.is_bulk ? (
        <View style={{
          width: 44, height: 44, borderRadius: 6,
          backgroundColor: theme.surface2,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="package" size={22} color={theme.accent} />
        </View>
      ) : (
        // mini grid icon
        <View style={{
          width: 44, height: 44, borderRadius: 6,
          backgroundColor: theme.surface2,
          borderWidth: 1, borderColor: theme.borderStrong,
          flexDirection: 'row', flexWrap: 'wrap', gap: 2,
          alignItems: 'center', justifyContent: 'center',
          padding: 4,
        }}>
          {Array.from({ length: Math.min(9, binder.grid_cols * binder.grid_rows) }).map((_, i) => (
            <View key={i} style={{
              width: 8, height: 10, borderRadius: 1,
              backgroundColor: theme.surface3,
            }} />
          ))}
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontFamily: theme.fontDisplay,
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
        style={{ padding: 4, marginRight: -4 }}
      >
        <Feather name="more-horizontal" size={18} color={theme.textMute} />
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
