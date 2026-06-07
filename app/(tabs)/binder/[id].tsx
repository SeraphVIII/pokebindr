// Single-binder view — paginated grid with optional page titles.
//
// Gestures (all live on the grid container):
//   - Fling left/right → flip page.
//   - Long-press (280 ms) then drag → drag-and-drop reorder.
//       • Dragging near the right/left edge for ~500 ms flips to the
//         next/previous page so you can move a card cross-page.
//       • Drop on a slot → splice the card into that slot and renumber
//         every position in the binder. Optimistic via useReorderCards.

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, Dimensions, Pressable, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform, Image, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector, Directions, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
  useAnimatedRef, useAnimatedScrollHandler, useFrameCallback, scrollTo,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { clampToContent } from '@/lib/layout';
import { Chip } from '@/components/Chip';
import { CardSlot, EmptySlot } from '@/components/CardSlot';
import {
  useBinder,
  useBinderPages,
  useCollectionByBinder,
  useEnsureBinderPages,
  useSetStatus,
  useAddPage,
  useUpdatePageTitle,
  useReorderCards,
  useRemoveCard,
  useRemoveCards,
  useDeletePage,
  useSwapPages,
  useReorderPage,
  useSetBinderVisibility,
  useMyProfile,
  useBinders,
  useMoveCards,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { SheetCard } from '@/components/SheetCard';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/lib/theme';
import type { Status, CollectionRow, BinderPage, Binder } from '@/lib/types';

type Filter = 'all' | Status;

const EDGE_FLIP_PX = 50;
const EDGE_FLIP_DELAY_MS = 800;
// Drag-to-page-browser hover thresholds. Reaching either of these mid-drag
// triggers a state change without releasing the card.
const PAGE_MENU_HOVER_MS = 600;
const BLOB_HOVER_MS = 600;

export default function BinderView() {
  const { id, page: pageParam } = useLocalSearchParams<{ id: string; page?: string }>();
  const router = useRouter();
  const { data: binder, isLoading: loadingBinder } = useBinder(id);
  const { data: pages = [] } = useBinderPages(id);
  const { data: rows = [] } = useCollectionByBinder(id);
  const setStatus = useSetStatus();
  const removeCard = useRemoveCard();
  const removeCards = useRemoveCards();
  const addPage = useAddPage();
  const updatePageTitle = useUpdatePageTitle();
  const reorder = useReorderCards();
  const deletePage = useDeletePage();
  const swapPages = useSwapPages();
  const reorderPage = useReorderPage();
  const setVisibility = useSetBinderVisibility();
  const { data: myProfile } = useMyProfile();
  const { data: allBinders = [] } = useBinders();
  const moveCards = useMoveCards();
  const ensurePages = useEnsureBinderPages();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');
  const [pageIdx, setPageIdx] = useState(() => {
    const p = pageParam ? parseInt(pageParam, 10) : 0;
    return Number.isFinite(p) ? Math.max(0, p) : 0;
  });
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // Which page the rename modal applies to. Null means "the page that's
  // currently visible in the binder" — set when the page-title pill is tapped.
  const [renameTargetPage, setRenameTargetPage] = useState<BinderPage | null>(null);
  // Tap-on-card opens an action sheet. We keep the *id* (not the row) so
  // the sheet picks up status changes from the cache as they happen.
  const [actionRowId, setActionRowId] = useState<string | null>(null);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  // Selection mode: when active, tapping a card toggles it in this set
  // instead of opening the action sheet, and drag is disabled.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shareOpen, setShareOpen] = useState(false);
  // When non-empty, the move-target picker is shown for these row ids.
  const [moveRowIds, setMoveRowIds] = useState<string[]>([]);
  // Default to list view for the bulk binder — its rows have no meaningful
  // slot positions, so a 3×3 grid layout would just look broken.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    if (binder?.is_bulk) setViewMode('list');
  }, [binder?.is_bulk]);

  // Drag state — separated into refs (for stale-closure-free reads inside
  // gesture callbacks) and React state (for re-render triggers).
  const [draggedAbsIdx, setDraggedAbsIdx] = useState<number | null>(null);
  const [hoverLocalIdx, setHoverLocalIdx] = useState<number | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Page-flip animation. The whole "track" (current page + neighbors) slides
  // as a single shared value. At idle, trackOffset = -pageIdx * gridW so the
  // page at left=pageIdx*gridW lands centered. Adjacent pages are
  // pre-rendered just off the visible area, so flips have no mount cost.
  const trackOffset = useSharedValue(0);
  const isFlippingRef = useRef(false);

  // Drag-to-page-browser state. While a card is being dragged, hovering
  // over the "Page menu" button area for ~600ms opens an inline page
  // overlay; from there, hovering a blob for ~600ms navigates the binder
  // to that page with the dragged card still under the finger.
  const [dragOverlayOpen, setDragOverlayOpen] = useState(false);
  const dragOverlayOpenRef = useRef(false);
  dragOverlayOpenRef.current = dragOverlayOpen;
  const pageMenuHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blobHoverIdx, setBlobHoverIdx] = useState<number | null>(null);
  const blobHoverIdxRef = useRef<number | null>(null);
  blobHoverIdxRef.current = blobHoverIdx;

  // Layout tracking for hit-testing inside the outer drag gesture.
  // `gestureRoot` covers spread + page menu bar + pagination; coords inside
  // onUpdate are relative to it.
  const [spreadH, setSpreadH] = useState(0);
  const [pageMenuRect, setPageMenuRect] = useState({ y: 0, h: 0 });
  const [gestureRootH, setGestureRootH] = useState(0);
  const spreadHRef = useRef(0);
  spreadHRef.current = spreadH;
  const pageMenuRectRef = useRef({ y: 0, h: 0 });
  pageMenuRectRef.current = pageMenuRect;
  const gestureRootHRef = useRef(0);
  gestureRootHRef.current = gestureRootH;
  // Ref for overlayBlobH used inside the dragGesture closure (not in its
  // useMemo deps). Without this, onUpdate reads a stale value from the
  // first render — which is why maxScroll came out as 0 with 11 pages.
  const overlayBlobHRef = useRef(0);

  // Drag-time overlay scroll. Driven by a Reanimated shared value so the
  // transform on the blob list updates on the UI thread without triggering
  // a JS re-render every tick.
  const overlayScrollY = useSharedValue(0);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filtered = useMemo(
    () => filter === 'all' ? rows : rows.filter((r) => r.status === filter),
    [filter, rows],
  );

  const cols = binder?.grid_cols ?? 3;
  const rowsN = binder?.grid_rows ?? 3;
  const slotsPerPage = cols * rowsN;
  // Cards live at fixed slot positions; "position" is a slot index, so
  // page count is derived from the largest position in use, not from card
  // count (gaps are allowed after a swap).
  const maxPos = useMemo(
    () => filtered.reduce((m, r) => Math.max(m, r.position), -1),
    [filtered],
  );
  const pageCount = Math.max(
    1, pages.length, Math.ceil((maxPos + 1) / slotsPerPage),
  );
  const current = Math.min(pageIdx, pageCount - 1);

  // Self-heal: if `rows`'s max position implies more pages than `binder_pages`
  // has rows for, backfill the missing rows. This catches binders mutated by
  // older app versions (or any past bug) that left positions sparse without
  // creating the matching page rows — symptom is a greyed "Page menu" pill
  // and a phantom page that's visible in the grid but absent from the menu.
  // Uses ALL rows (not the filter) so the heal isn't gated by chip state.
  const totalMaxPos = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.position), -1),
    [rows],
  );
  const pagesNeededTotal = Math.max(1, Math.ceil((totalMaxPos + 1) / slotsPerPage));
  const ensureMutate = ensurePages.mutate;
  const ensureIsPending = ensurePages.isPending;
  useEffect(() => {
    if (!binder || rows.length === 0) return;
    if (pagesNeededTotal > pages.length && !ensureIsPending) {
      ensureMutate(binder.id);
    }
  }, [binder, rows.length, pagesNeededTotal, pages.length, ensureIsPending, ensureMutate]);

  // Lookup map: absolute position → card. Used to render slots and to
  // detect what (if anything) lives at the drop target.
  const cardByPos = useMemo(() => {
    const m = new Map<number, CollectionRow>();
    for (const r of filtered) m.set(r.position, r);
    return m;
  }, [filtered]);

  // The pager window. Renders the current page plus its immediate
  // neighbors so a flip animation has nothing to mount.
  const windowPages = useMemo(() => {
    const out: { p: number; slots: (CollectionRow | null)[] }[] = [];
    const lo = Math.max(0, pageIdx - 1);
    const hi = Math.min(pageCount - 1, pageIdx + 1);
    for (let p = lo; p <= hi; p++) {
      const slots = Array.from({ length: slotsPerPage }, (_, i) =>
        cardByPos.get(p * slotsPerPage + i) ?? null,
      );
      out.push({ p, slots });
    }
    return out;
  }, [pageIdx, pageCount, slotsPerPage, cardByPos]);

  // Refs that gesture callbacks read on every tick — keeps closures fresh.
  const currentRef = useRef(current);
  currentRef.current = current;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const cardByPosRef = useRef(cardByPos);
  cardByPosRef.current = cardByPos;
  const binderRef = useRef(binder);
  binderRef.current = binder;
  const draggedAbsIdxRef = useRef<number | null>(null);
  draggedAbsIdxRef.current = draggedAbsIdx;
  const hoverLocalIdxRef = useRef<number | null>(null);
  hoverLocalIdxRef.current = hoverLocalIdx;

  // Layout numbers (need them before the gesture is built so callbacks can
  // close over them). Clamped to theme.maxContentW so cards stay phone-sized
  // on wide desktop browsers.
  const winW = clampToContent(Dimensions.get('window').width);
  const railPad = 20;
  const gap = 8;
  const innerW = winW - railPad * 2 - 12 - 6;
  const cardW = (innerW - gap * (cols - 1)) / cols;
  const cardH = cardW * 1.4;
  const gridW = cols * cardW + (cols - 1) * gap;
  const gridH = rowsN * cardH + (rowsN - 1) * gap;
  // Grid's x in gesture-root coordinates is constant: spread paddingHorizontal
  // (railPad) + rail width (12) + paddingLeft (6). Grid's y depends on
  // spread height — captured via onLayout and read through spreadHRef.
  const gridXInRoot = railPad + 12 + 6;

  // Drag-overlay blob grid layout (mirrors PageBrowserModal but laid out
  // in the gesture root so onUpdate can hit-test against it).
  const OVERLAY_SIDE_PAD = 16;
  const OVERLAY_TOP_PAD = 56;
  const OVERLAY_BLOB_GAP = 12;
  const overlayBlobW = (winW - OVERLAY_SIDE_PAD * 2 - OVERLAY_BLOB_GAP) / 2;
  const OVERLAY_BLOB_PAD = 8;
  const OVERLAY_HDR_H = 18;
  const OVERLAY_HDR_GAP = 6;
  const overlayInnerW = overlayBlobW - OVERLAY_BLOB_PAD * 2;
  const overlayCardG = 2;
  const overlayMiniW = (overlayInnerW - overlayCardG * (cols - 1)) / cols;
  const overlayMiniH = overlayMiniW * 1.4;
  const overlayMiniGridH = rowsN * overlayMiniH + (rowsN - 1) * overlayCardG;
  const overlayBlobH = OVERLAY_HDR_H + OVERLAY_HDR_GAP + OVERLAY_BLOB_PAD * 2 + overlayMiniGridH;
  overlayBlobHRef.current = overlayBlobH;

  // Map a gesture-root point to a blob index, or null if outside the grid.
  // Accounts for the overlay's current scroll offset so blobs match what
  // the user sees, not where they started.
  const blobAtRootPoint = (x: number, y: number): number | null => {
    const cx = x - OVERLAY_SIDE_PAD;
    const cy = y - OVERLAY_TOP_PAD + overlayScrollY.value;
    if (cx < 0 || cy < 0) return null;
    const colWidth = overlayBlobW + OVERLAY_BLOB_GAP;
    const rowHeight = overlayBlobH + OVERLAY_BLOB_GAP;
    const col = Math.floor(cx / colWidth);
    if (col < 0 || col > 1) return null;
    if (cx - col * colWidth > overlayBlobW) return null; // in the inter-column gap
    const row = Math.floor(cy / rowHeight);
    if (row < 0) return null;
    if (cy - row * rowHeight > overlayBlobH) return null; // in the inter-row gap
    const idx = row * 2 + col;
    if (idx < 0 || idx >= pageCount) return null;
    return idx;
  };
  const blobAtRef = useRef(blobAtRootPoint);
  blobAtRef.current = blobAtRootPoint;

  const slotPos = (localIdx: number) => ({
    left: (localIdx % cols) * (cardW + gap),
    top: Math.floor(localIdx / cols) * (cardH + gap),
  });

  const pointToSlot = (x: number, y: number): number | null => {
    if (x < 0 || y < 0 || x > gridW || y > gridH) return null;
    const col = Math.min(cols - 1, Math.floor(x / (cardW + gap)));
    const r   = Math.min(rowsN - 1, Math.floor(y / (cardH + gap)));
    if (col < 0 || r < 0) return null;
    return r * cols + col;
  };

  const cancelFlip = () => {
    if (flipTimerRef.current) {
      clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
    }
  };
  const cancelPageMenuHover = () => {
    if (pageMenuHoverTimerRef.current) {
      clearTimeout(pageMenuHoverTimerRef.current);
      pageMenuHoverTimerRef.current = null;
    }
  };
  const cancelBlobHover = () => {
    if (blobHoverTimerRef.current) {
      clearTimeout(blobHoverTimerRef.current);
      blobHoverTimerRef.current = null;
    }
    if (blobHoverIdxRef.current !== null) setBlobHoverIdx(null);
  };
  const stopAutoScroll = () => {
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  };
  // Auto-scroll step is a ref so a running interval picks up the latest
  // edge-zone depth without being restarted every onUpdate tick.
  const autoScrollStepRef = useRef(18);
  const startAutoScroll = (dir: 1 | -1, maxY: number, step = 18) => {
    autoScrollStepRef.current = step;
    if (autoScrollTimerRef.current) return;
    autoScrollTimerRef.current = setInterval(() => {
      const cur = overlayScrollY.value;
      const next = Math.max(0, Math.min(maxY, cur + dir * autoScrollStepRef.current));
      if (next === cur) return;
      overlayScrollY.value = next;
      // Scrolling moves blobs under the finger — clear the pending nav.
      cancelBlobHover();
    }, 16);
  };

  // User-initiated page flip: haptic + slide of the whole pager track.
  // Adjacent pages are already mounted, so the only thing that changes is
  // the track's translateX — no React commit happens mid-animation.
  const clearFlipping = () => { isFlippingRef.current = false; };
  const flipPage = (dir: 1 | -1) => {
    const cur = currentRef.current;
    const total = pageCountRef.current;
    const next = dir === 1 ? Math.min(total - 1, cur + 1) : Math.max(0, cur - 1);
    if (next === cur) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    isFlippingRef.current = true;
    trackOffset.value = withTiming(-next * gridW, { duration: 260 }, (done) => {
      if (done) runOnJS(clearFlipping)();
    });
    setPageIdx(next);
  };

  // Non-animated jumps (filter chip, add/delete/swap page). Keeps the track
  // in sync without sliding.
  const jumpToPage = (idx: number) => {
    trackOffset.value = -idx * gridW;
    setPageIdx(idx);
  };

  // Initial mount + grid-size change: snap the track to match pageIdx.
  // Skipped while a flip animation is in flight so it doesn't fight withTiming.
  const pageIdxRef = useRef(pageIdx);
  pageIdxRef.current = pageIdx;
  useEffect(() => {
    if (!isFlippingRef.current) {
      trackOffset.value = -pageIdxRef.current * gridW;
    }
  }, [gridW, trackOffset]);
  const flipPageRef = useRef(flipPage);
  flipPageRef.current = flipPage;
  const jumpToPageRef = useRef(jumpToPage);
  jumpToPageRef.current = jumpToPage;

  const scheduleFlip = (dir: 1 | -1) => {
    if (flipTimerRef.current) return;
    flipTimerRef.current = setTimeout(() => {
      flipTimerRef.current = null;
      flipPageRef.current(dir);
    }, EDGE_FLIP_DELAY_MS);
  };

  const handleDrop = (draggedAbs: number, targetLocal: number, page: number) => {
    const map = cardByPosRef.current;
    const b = binderRef.current;
    const targetAbs = page * slotsPerPage + targetLocal;
    if (draggedAbs === targetAbs) return;
    const dragged = map.get(draggedAbs);
    if (!dragged || !b) return;
    const target = map.get(targetAbs);

    const updates = [{ id: dragged.id, position: targetAbs }];
    if (target) updates.push({ id: target.id, position: draggedAbs });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reorder.mutate(
      { binderId: b.id, updates },
      {
        onError: (e: any) => {
          toast.error(e?.message ?? 'Reorder failed');
        },
      },
    );
  };

  // ─── gestures ────────────────────────────────────────────────────────
  const swipeGesture = useMemo(() => {
    const left = Gesture.Fling()
      .direction(Directions.LEFT)
      .runOnJS(true)
      .onEnd(() => flipPageRef.current(1));
    const right = Gesture.Fling()
      .direction(Directions.RIGHT)
      .runOnJS(true)
      .onEnd(() => flipPageRef.current(-1));
    return Gesture.Race(left, right);
    // flipPage via ref, so no deps
  }, []);

  const dragGesture = useMemo(() => {
    return Gesture.Pan()
      .activateAfterLongPress(280)
      .runOnJS(true)
      .onStart((e) => {
        // Gesture is rooted on the bigger container; translate to grid coords.
        const gridY = (spreadHRef.current - gridH) / 2;
        const lx = e.x - gridXInRoot;
        const ly = e.y - gridY;
        const local = pointToSlot(lx, ly);
        if (local === null) return; // drag must start inside a slot
        const abs = currentRef.current * slotsPerPage + local;
        if (!cardByPosRef.current.has(abs)) return; // no card to drag
        setDraggedAbsIdx(abs);
        setHoverLocalIdx(local);
        dragX.value = e.x;
        dragY.value = e.y;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      })
      .onUpdate((e) => {
        if (draggedAbsIdxRef.current === null) return;
        dragX.value = e.x;
        dragY.value = e.y;

        if (dragOverlayOpenRef.current) {
          // OVERLAY ZONE: hit-test against page blobs + maybe auto-scroll.
          cancelFlip();
          cancelPageMenuHover();
          // Don't drop on slots while overlay is up.
          if (hoverLocalIdxRef.current !== null) setHoverLocalIdx(null);

          // Compute the auto-scroll envelope from the total content size.
          // Read pageCount + overlayBlobH from refs so we get the LATEST
          // values, not whatever the gesture's useMemo closure captured on
          // first mount.
          const liveBlobH = overlayBlobHRef.current;
          const liveCount = pageCountRef.current;
          const rowCount = Math.ceil(liveCount / 2);
          const totalContentH = rowCount * liveBlobH + Math.max(0, rowCount - 1) * OVERLAY_BLOB_GAP;
          const viewportH = Math.max(0, gestureRootHRef.current - OVERLAY_TOP_PAD - 12);
          const maxScroll = Math.max(0, totalContentH - viewportH);
          // Generous band at the very top/bottom edges of the overlay.
          // canScrollUp/Down keep the zones out of the way at the limits.
          // 120 px gives a clear, easy-to-hit target without eating most of
          // the overlay; was 70 px which was hard to find blind during a drag.
          const AUTOSCROLL_ZONE = 120;
          const cur = overlayScrollY.value;
          const canScrollDown = cur < maxScroll - 0.5;
          const canScrollUp = cur > 0.5;
          const inTopZone = canScrollUp && e.y < OVERLAY_TOP_PAD + AUTOSCROLL_ZONE;
          const inBottomZone = canScrollDown && e.y > gestureRootHRef.current - AUTOSCROLL_ZONE;

          if (inTopZone || inBottomZone) {
            // Auto-scroll takes priority over navigation. While the finger
            // is parked in the edge band, we just scroll — no blob nav fires.
            // Speed scales with how deep into the edge band the finger is, so
            // the user can ease in/out instead of all-or-nothing.
            const depth = inBottomZone
              ? Math.min(1, (e.y - (gestureRootHRef.current - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE)
              : Math.min(1, ((OVERLAY_TOP_PAD + AUTOSCROLL_ZONE) - e.y) / AUTOSCROLL_ZONE);
            startAutoScroll(inBottomZone ? 1 : -1, maxScroll, 14 + Math.max(0, depth) * 24);
            cancelBlobHover();
            return;
          }
          stopAutoScroll();

          const idx = blobAtRef.current(e.x, e.y);
          if (idx !== blobHoverIdxRef.current) {
            cancelBlobHover();
            if (idx !== null) {
              setBlobHoverIdx(idx);
              blobHoverTimerRef.current = setTimeout(() => {
                blobHoverTimerRef.current = null;
                // Navigate to this page and close the overlay; drag continues.
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                jumpToPageRef.current(idx);
                setDragOverlayOpen(false);
                setBlobHoverIdx(null);
                stopAutoScroll();
              }, BLOB_HOVER_MS);
            }
          }
          return;
        }
        // Outside overlay zone: stop any auto-scroll still running.
        stopAutoScroll();

        // GRID ZONE: existing in-grid drag-and-drop targeting.
        const gridY = (spreadHRef.current - gridH) / 2;
        const lx = e.x - gridXInRoot;
        const ly = e.y - gridY;
        const inGrid = lx >= 0 && lx <= gridW && ly >= 0 && ly <= gridH;
        const local = inGrid ? pointToSlot(lx, ly) : null;
        if (local !== hoverLocalIdxRef.current) setHoverLocalIdx(local);

        // Edge-flip fires whenever the finger is near the left/right edge
        // band AND roughly within the grid's vertical range — even if the
        // finger has drifted a bit past the grid bounds horizontally.
        const EDGE_FLIP_VPAD = 60;
        const nearGridY = ly >= -EDGE_FLIP_VPAD && ly <= gridH + EDGE_FLIP_VPAD;
        if (nearGridY && lx > gridW - EDGE_FLIP_PX && currentRef.current < pageCountRef.current - 1) {
          scheduleFlip(1);
        } else if (nearGridY && lx < EDGE_FLIP_PX && currentRef.current > 0) {
          scheduleFlip(-1);
        } else {
          cancelFlip();
        }

        // PAGE-MENU HOVER: outside grid AND within the page menu band.
        const pm = pageMenuRectRef.current;
        const overPageMenu = !inGrid && e.y >= pm.y && e.y <= pm.y + pm.h;
        if (overPageMenu) {
          if (!pageMenuHoverTimerRef.current) {
            pageMenuHoverTimerRef.current = setTimeout(() => {
              pageMenuHoverTimerRef.current = null;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              overlayScrollY.value = 0;
              setDragOverlayOpen(true);
            }, PAGE_MENU_HOVER_MS);
          }
        } else {
          cancelPageMenuHover();
        }
      })
      .onEnd(() => {
        const drag = draggedAbsIdxRef.current;
        const hover = hoverLocalIdxRef.current;
        // Drop ONLY if user released over a grid slot AND the overlay isn't up.
        if (!dragOverlayOpenRef.current && drag !== null && hover !== null) {
          handleDrop(drag, hover, currentRef.current);
        }
        setDraggedAbsIdx(null);
        setHoverLocalIdx(null);
        setDragOverlayOpen(false);
        cancelFlip();
        cancelPageMenuHover();
        cancelBlobHover();
        stopAutoScroll();
      })
      .onFinalize(() => {
        // Safety net if onEnd doesn't fire (interruption).
        if (draggedAbsIdxRef.current !== null) {
          setDraggedAbsIdx(null);
          setHoverLocalIdx(null);
        }
        setDragOverlayOpen(false);
        cancelFlip();
        cancelPageMenuHover();
        cancelBlobHover();
        stopAutoScroll();
      });
    // closures via refs — no deps
  }, [cardW, cardH, gridW, gridH, slotsPerPage]);

  // The drag gesture lives on the outer container (spread + page menu +
  // pagination) so the dragged card can survive transitions into the
  // drag-time overlay. Swipe stays scoped to the grid view.
  const outerGesture = useMemo(
    () => selecting ? Gesture.Tap().enabled(false) : dragGesture,
    [dragGesture, selecting],
  );
  const innerGesture = useMemo(
    () => selecting ? Gesture.Tap().enabled(false) : swipeGesture,
    [swipeGesture, selecting],
  );

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value - cardW / 2 },
      { translateY: dragY.value - cardH / 2 },
    ],
  }));
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trackOffset.value }],
  }));
  const overlayScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -overlayScrollY.value }],
  }));

  if (loadingBinder || !binder) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }

  const currentPage = pages[current];
  const start = current * slotsPerPage;

  // Sum of last known prices for cards on the current page.
  let pagePriceEur = 0;
  for (let i = 0; i < slotsPerPage; i++) {
    const row = cardByPos.get(start + i);
    if (row?.last_price_eur != null) pagePriceEur += row.last_price_eur;
  }

  const draggedRow = draggedAbsIdx !== null ? cardByPos.get(draggedAbsIdx) ?? null : null;

  // ─── handlers ────────────────────────────────────────────────────────
  const openRenameModal = (target?: BinderPage | null) => {
    const page = target ?? currentPage;
    if (!page) return;
    setRenameTargetPage(target ?? null);
    setTitleDraft(page.title ?? '');
    setTitleModalOpen(true);
  };
  const saveTitle = () => {
    const target = renameTargetPage ?? currentPage;
    if (!target) return;
    updatePageTitle.mutate({
      pageId: target.id,
      binderId: binder.id,
      title: titleDraft.trim() ? titleDraft.trim() : null,
    });
    setTitleModalOpen(false);
    setRenameTargetPage(null);
  };
  const onAddPage = () => {
    // Insert directly after the page the user is viewing rather than at the
    // tail. The new page lands at index `current + 1`; reorder_binder_page
    // shifts everything from `current + 1` onward down by one (including
    // card positions), so the new page is the one we should jump to.
    addPage.mutate({ binderId: binder.id, afterIndex: current });
    jumpToPage(current + 1);
  };
  // Delete-current-page is shared between the header trash icon and the
  // page-browser action sheet. Same safety checks apply in both places:
  // last page is undeletable, non-empty pages refuse to delete.
  const onDeletePage = async (page: BinderPage) => {
    if (pageCount <= 1) {
      toast.error('A binder needs at least one page.');
      return;
    }
    const pStart = page.page_index * slotsPerPage;
    const hasCards = Array.from({ length: slotsPerPage }).some(
      (_, i) => cardByPos.has(pStart + i),
    );
    if (hasCards) {
      toast.error('Remove all cards from this page first.');
      return;
    }
    const ok = await confirm({
      title: 'Delete page?',
      message: page.title || 'Untitled page',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deletePage.mutateAsync({ pageId: page.id, binderId: binder.id });
    if (page.page_index === current) {
      jumpToPage(Math.max(0, current - 1));
    }
  };
  const onDeleteCurrentPage = () => {
    if (currentPage) onDeletePage(currentPage);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      {selecting ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2, gap: 8,
        }}>
          <Pressable onPress={() => { setSelecting(false); setSelected(new Set()); }} hitSlop={12}>
            <Text style={{
              color: theme.textDim, fontFamily: theme.fontUIBold,
              fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Cancel</Text>
          </Pressable>
          <Text style={{
            color: theme.text, fontFamily: theme.fontMono, fontSize: 12,
            letterSpacing: 1.5, textTransform: 'uppercase',
          }}>{selected.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 14 }}>
          {(() => {
            const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
            return (
              <Pressable
                onPress={() => {
                  if (allSelected) setSelected(new Set());
                  else setSelected(new Set(filtered.map((r) => r.id)));
                }}
                disabled={filtered.length === 0}
                hitSlop={12}>
                <Text style={{
                  color: filtered.length === 0 ? theme.textMute : theme.accent,
                  fontFamily: theme.fontUIBold,
                  fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
                }}>{allSelected ? 'None' : 'All'}</Text>
              </Pressable>
            );
          })()}
          <Pressable
            onPress={() => {
              if (selected.size === 0) return;
              setMoveRowIds(Array.from(selected));
            }}
            disabled={selected.size === 0}
            hitSlop={12}
          >
            <Text style={{
              color: selected.size === 0 ? theme.textMute : theme.accent,
              fontFamily: theme.fontUIBold,
              fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Move</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              if (selected.size === 0) return;
              const ids = Array.from(selected);
              const ok = await confirm({
                title: `Remove ${ids.length} ${ids.length === 1 ? 'card' : 'cards'}?`,
                message: 'This deletes the selected cards from this binder.',
                confirmText: 'Remove',
                destructive: true,
              });
              if (!ok) return;
              await removeCards.mutateAsync(ids);
              setSelected(new Set());
              setSelecting(false);
            }}
            disabled={selected.size === 0}
            hitSlop={12}
          >
            <Text style={{
              color: selected.size === 0 ? theme.textMute : theme.statusReally,
              fontFamily: theme.fontUIBold,
              fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Delete</Text>
          </Pressable>
          </View>
        </View>
      ) : (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2,
        }}>
          <Pressable
            onPress={() => router.navigate('/binder')}
            hitSlop={12}
            accessibilityLabel="Back to all binders">
            <Feather name="arrow-left" size={22} color={theme.textDim} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Pressable onPress={() => setViewMode((m) => (m === 'grid' ? 'list' : 'grid'))} hitSlop={12}>
              <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={18} color={theme.textDim} />
            </Pressable>
            <Pressable onPress={() => setShareOpen(true)} hitSlop={12}>
              <Feather
                name={binder?.visibility === 'public' ? 'globe' : binder?.visibility === 'unlisted' ? 'link' : 'lock'}
                size={18}
                color={binder?.visibility !== 'private' ? theme.accent : theme.textDim}
              />
            </Pressable>
            <Pressable onPress={() => setSelecting(true)} hitSlop={12}>
              <Feather name="check-square" size={18} color={theme.textDim} />
            </Pressable>
            <Pressable
              onPress={onDeleteCurrentPage}
              hitSlop={12}
              accessibilityLabel="Delete this page"
            >
              <Feather name="trash-2" size={18} color={theme.textDim} />
            </Pressable>
          </View>
        </View>
      )}

      <View style={{ paddingHorizontal: 24, paddingTop: 4 }}>
        <Eyebrow>{cols}×{rowsN} · {rows.length} {rows.length === 1 ? 'card' : 'cards'}</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 26, color: theme.text, marginTop: 4, lineHeight: 34,
        }}>{binder.name}</Text>
      </View>

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 24, paddingVertical: 10,
      }}>
        {/* Filter chips no longer jump to page 0 — the page count derives
            from the highest filtered position, so pageIdx clamps itself if
            the new filter has fewer pages than the current page. Letting the
            user stay on their current page is less surprising. */}
        <Chip label="All"    active={filter === 'all'}    onPress={() => setFilter('all')} />
        <Chip label="Have"   active={filter === 'have'}   color={theme.statusHave}   onPress={() => setFilter('have')} />
        <Chip label="Want"   active={filter === 'want'}   color={theme.statusWant}   onPress={() => setFilter('want')} />
        <Chip label="Need" active={filter === 'really'} color={theme.statusReally} onPress={() => setFilter('really')} />
      </View>

      {viewMode === 'grid' ? <>
      {/* Reserve a fixed slot for the page title + total so titled vs
          untitled pages don't shift the grid vertically. Height needs to
          accommodate Cormorant's descenders (g/y/p) at 22pt + a few px of
          breathing room — 32 used to clip the bottoms. */}
      <View style={{
        paddingHorizontal: 24, paddingBottom: 6, height: 40,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Pressable
          onPress={() => openRenameModal()}
          disabled={!currentPage}
          hitSlop={4}
          style={{ flexShrink: 1 }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontFamily: theme.fontDisplay,
              fontSize: 22,
              lineHeight: 30,
              color: currentPage?.title ? theme.accent : theme.textDim,
            }}>
            {currentPage?.title ?? '+ Page title'}
          </Text>
        </Pressable>
        {pagePriceEur > 0 && (
          <Text style={{
            color: theme.textDim, fontFamily: theme.fontMono,
            fontSize: 13, letterSpacing: 0.3,
          }}>
            €{pagePriceEur.toFixed(2)}
          </Text>
        )}
      </View>

      <GestureDetector gesture={outerGesture}>
      <View
        style={{ flex: 1, position: 'relative' }}
        onLayout={(e) => setGestureRootH(e.nativeEvent.layout.height)}
      >

      {/* spread */}
      <View
        style={{ flex: 1, paddingHorizontal: railPad, justifyContent: 'center' }}
        onLayout={(e) => setSpreadH(e.nativeEvent.layout.height)}
      >
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 12, justifyContent: 'space-around', alignItems: 'center', paddingVertical: 4 }}>
            {Array.from({ length: rowsN + 1 }).map((_, i) => (
              <View key={i} style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: theme.surface2,
                borderWidth: 0.5, borderColor: theme.border,
              }} />
            ))}
          </View>

          <View style={{ paddingLeft: 6 }}>
            <GestureDetector gesture={innerGesture}>
              <View style={{
                width: gridW, height: gridH, position: 'relative',
              }}>
                <View style={{
                  position: 'absolute', left: 0, top: 0,
                  width: gridW, height: gridH,
                  overflow: 'hidden',
                }}>
                <Animated.View style={[{
                  position: 'absolute', left: 0, top: 0,
                  width: gridW, height: gridH,
                }, trackStyle]}>
                  {windowPages.map(({ p, slots }) => {
                    const isCurrent = p === current;
                    return (
                      <View key={p} style={{
                        position: 'absolute',
                        left: p * gridW, top: 0,
                        width: gridW, height: gridH,
                      }}>
                        {slots.map((r, i) => {
                          const pos = slotPos(i);
                          if (!isCurrent) {
                            // Off-screen neighbor: visual only.
                            return (
                              <View key={r?.id ?? `n-${p}-${i}`} style={{
                                position: 'absolute',
                                left: pos.left, top: pos.top,
                                width: cardW, height: cardH,
                              }}>
                                {r ? <CardSlot row={r} width={cardW} /> : null}
                              </View>
                            );
                          }
                          const isHover = hoverLocalIdx === i && draggedAbsIdx !== null;
                          const isDragged = !!(r && draggedRow && r.id === draggedRow.id);
                          const isSelected = !!(r && selected.has(r.id));
                          return (
                            <View key={r?.id ?? `empty-${i}`} style={{
                              position: 'absolute',
                              left: pos.left, top: pos.top,
                              width: cardW, height: cardH,
                              opacity: isDragged ? 0.25 : 1,
                            }}>
                              {r ? (
                                <CardSlot
                                  row={r}
                                  width={cardW}
                                  onPress={() => {
                                    if (selecting) {
                                      setSelected((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(r.id)) next.delete(r.id);
                                        else next.add(r.id);
                                        return next;
                                      });
                                    } else {
                                      setActionRowId(r.id);
                                    }
                                  }}
                                />
                              ) : (
                                <EmptySlot
                                  width={cardW}
                                  onPress={() =>
                                    router.push(
                                      `/lookup?binderId=${binder.id}&position=${start + i}&page=${current}`,
                                    )
                                  }
                                />
                              )}
                              {isHover && (
                                <View pointerEvents="none" style={{
                                  position: 'absolute',
                                  left: 0, top: 0, right: 0, bottom: 0,
                                  borderRadius: Math.max(6, cardW * 0.07),
                                  borderWidth: 2,
                                  borderColor: theme.accent,
                                }} />
                              )}
                              {isSelected && (
                                <View pointerEvents="none" style={{
                                  position: 'absolute',
                                  left: 0, top: 0, right: 0, bottom: 0,
                                  borderRadius: Math.max(4, cardW * 0.07),
                                  backgroundColor: 'rgba(212,175,55,0.25)',
                                  borderWidth: 2,
                                  borderColor: theme.accent,
                                  alignItems: 'flex-end',
                                  padding: 4,
                                }}>
                                  <View style={{
                                    width: 22, height: 22, borderRadius: 11,
                                    backgroundColor: theme.accent,
                                    alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    <Feather name="check" size={14} color={theme.accentText} />
                                  </View>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </Animated.View>
                </View>

              </View>
            </GestureDetector>
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 18, paddingTop: 6,
        }}
        onLayout={(e) => setPageMenuRect({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
      >
        <Pressable onPress={() => setPageMenuOpen(true)} disabled={!currentPage} hitSlop={8}>
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 10, letterSpacing: 1.5,
            color: dragOverlayOpen ? theme.accent : currentPage ? theme.accent : theme.textMute,
            textTransform: 'uppercase',
          }}>{draggedRow ? 'Page menu · hold here' : 'Page menu'}</Text>
        </Pressable>
        <Pressable onPress={onAddPage} hitSlop={8}>
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 10, letterSpacing: 1.5,
            color: theme.accent, textTransform: 'uppercase',
          }}>+ Add page</Text>
        </Pressable>
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: 18,
      }}>
        <ArrowBtn dir="left"  disabled={current === 0}              onPress={() => flipPage(-1)} />
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, letterSpacing: 1.5,
        }}>
          PAGE {String(current + 1).padStart(2, '0')} / {String(pageCount).padStart(2, '0')}
        </Text>
        <ArrowBtn dir="right" disabled={current >= pageCount - 1} onPress={() => flipPage(1)} />
      </View>

      {/* Drag-time page browser overlay. Mounts inside the gesture root so
          the Pan gesture survives showing/hiding it. ScrollView is auto-
          driven by the parent gesture (finger near top/bottom edge). */}
      {dragOverlayOpen && (() => {
        const rowCount = Math.ceil(pageCount / 2);
        const totalContentH = rowCount * overlayBlobH + Math.max(0, rowCount - 1) * OVERLAY_BLOB_GAP;
        const viewportH = Math.max(0, gestureRootH - OVERLAY_TOP_PAD - 12);
        const canScrollMore = totalContentH > viewportH;
        return (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(12,10,8,0.94)',
              zIndex: 5,
            }}>
            <Text style={{
              position: 'absolute', top: 18, left: 0, right: 0,
              color: theme.textDim, fontFamily: theme.fontMono, fontSize: 11,
              letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center',
            }}>
              Hover a page to jump{canScrollMore ? ' · drag to edges to scroll' : ''}
            </Text>

            {/* Edge affordances — only visible when content overflows, so they
                advertise the auto-scroll bands without cluttering small lists. */}
            {canScrollMore && (
              <>
                <View style={{
                  position: 'absolute', top: OVERLAY_TOP_PAD,
                  left: 0, right: 0, alignItems: 'center',
                }}>
                  <Feather name="chevron-up" size={18} color={theme.textDim} />
                </View>
                <View style={{
                  position: 'absolute', bottom: 12,
                  left: 0, right: 0, alignItems: 'center',
                }}>
                  <Feather name="chevron-down" size={18} color={theme.textDim} />
                </View>
              </>
            )}


            <View
              style={{
                position: 'absolute',
                top: OVERLAY_TOP_PAD,
                left: 0, right: 0, bottom: 0,
                overflow: 'hidden',
              }}>
              <Animated.View
                style={[
                  {
                    position: 'absolute',
                    left: 0, top: 0,
                    width: winW,
                    height: totalContentH,
                  },
                  overlayScrollStyle,
                ]}
              >
                {Array.from({ length: pageCount }).map((_, idx) => {
                  const page = pages[idx];
                  const col = idx % 2;
                  const row = Math.floor(idx / 2);
                  const isCur = idx === current;
                  const isHov = blobHoverIdx === idx;
                  return (
                    <View
                      key={page?.id ?? `idx-${idx}`}
                      style={{
                        position: 'absolute',
                        left: OVERLAY_SIDE_PAD + col * (overlayBlobW + OVERLAY_BLOB_GAP),
                        top: row * (overlayBlobH + OVERLAY_BLOB_GAP),
                        width: overlayBlobW, height: overlayBlobH,
                      }}>
                      <PageBlob
                        p={idx}
                        pageTitle={page?.title ?? null}
                        blobW={overlayBlobW}
                        blobH={overlayBlobH}
                        innerW={overlayInnerW}
                        cardCols={cols}
                        cardRowsN={rowsN}
                        slotsPerPage={slotsPerPage}
                        miniCardW={overlayMiniW}
                        miniCardH={overlayMiniH}
                        miniGridH={overlayMiniGridH}
                        cardG={overlayCardG}
                        blobPad={OVERLAY_BLOB_PAD}
                        headerH={OVERLAY_HDR_H}
                        headerGap={OVERLAY_HDR_GAP}
                        cardByPos={cardByPos}
                        isCurrent={isCur}
                        isDragged={false}
                        isHovered={isHov}
                      />
                    </View>
                  );
                })}
              </Animated.View>
            </View>
          </View>
        );
      })()}

      {/* Dragged card overlay — sits at the gesture root so it can travel
          anywhere on screen (across the grid AND the drag-time overlay). */}
      {draggedRow && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0, top: 0,
              width: cardW, height: cardH,
              zIndex: 100,
            },
            overlayStyle,
          ]}
        >
          <View style={{ width: cardW, height: cardH, opacity: 0.92 }}>
            <CardSlot row={draggedRow} width={cardW} />
          </View>
        </Animated.View>
      )}

      </View>
      </GestureDetector>
      </> : (
        <BinderListCards
          rows={rows}
          selecting={selecting}
          selected={selected}
          onTap={(r) => {
            if (selecting) {
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                return next;
              });
            } else {
              router.push(`/card/${r.card_id}?row=${r.id}`);
            }
          }}
          onLongPress={(r) => {
            if (!selecting) {
              setSelecting(true);
              setSelected(new Set([r.id]));
            }
          }}
        />
      )}

      <PageBrowserModal
        open={pageMenuOpen}
        onClose={() => setPageMenuOpen(false)}
        binder={binder}
        pages={pages}
        cardByPos={cardByPos}
        current={current}
        pageCount={pageCount}
        slotsPerPage={slotsPerPage}
        onSelectPage={(idx) => { jumpToPage(idx); setPageMenuOpen(false); }}
        onReorderPage={async (page, toIdx) => {
          const src = page.page_index;
          // Adjacent-forward (drag n onto n+1) is the one case where
          // "insert in front of target" collapses to a no-op (newIndex
          // would equal src). Special-case it to a swap so the gesture
          // produces the obvious result: the two pages exchange. Adjacent-
          // backward (n+1 onto n) already swaps as a natural side effect
          // of the splice insertion.
          if (src + 1 === toIdx) {
            const newCurr =
              current === src ? toIdx :
              current === toIdx ? src :
              current;
            await swapPages.mutateAsync({
              binderId: binder.id,
              idxA: src,
              idxB: toIdx,
            });
            if (newCurr !== current) jumpToPage(newCurr);
            return;
          }
          // "Insert in front of target" semantics: dropping on slot N
          // means the dragged page lands IMMEDIATELY BEFORE the page that
          // was at N. The SQL reorder_binder_page is splice-insertion, so
          // for a downward drag (src < toIdx) the dragged page lands at the
          // newIndex we pass; passing toIdx-1 makes it stop one slot
          // earlier — right in front of the target.
          const newIndex = src < toIdx ? toIdx - 1 : toIdx;
          if (newIndex === src) return;
          // Predict where the previously-viewed page lands so the binder
          // keeps following the user's actual content (not a fixed index).
          let newCurr = current;
          if (current === src) newCurr = newIndex;
          else if (src < newIndex && current > src && current <= newIndex) newCurr = current - 1;
          else if (src > newIndex && current >= newIndex && current < src) newCurr = current + 1;
          await reorderPage.mutateAsync({
            binderId: binder.id, pageId: page.id, newIndex,
          });
          if (newCurr !== current) jumpToPage(newCurr);
        }}
        onMovePage={(page, dir) => {
          const other = dir === 'left' ? page.page_index - 1 : page.page_index + 1;
          if (other < 0 || other >= pageCount) return;
          swapPages.mutate({
            binderId: binder.id,
            idxA: page.page_index,
            idxB: other,
          });
          // Keep the viewer on the same content: if the moved or swapped
          // page was the currently-visible one, follow it to its new index.
          if (current === page.page_index) jumpToPage(other);
          else if (current === other) jumpToPage(page.page_index);
        }}
        onRenamePage={(page) => {
          setPageMenuOpen(false);
          openRenameModal(page);
        }}
        onDeletePage={onDeletePage}
        onAddPage={onAddPage}
      />

      <CardActionSheet
        row={actionRowId ? filtered.find((r) => r.id === actionRowId) ?? null : null}
        onClose={() => setActionRowId(null)}
        onInfo={(row) => {
          setActionRowId(null);
          router.push(`/card/${row.card_id}?row=${row.id}`);
        }}
        onStatus={(row, s) => setStatus.mutate({ rowId: row.id, status: s })}
        onMove={(row) => {
          setActionRowId(null);
          setMoveRowIds([row.id]);
        }}
        onDelete={async (row) => {
          const ok = await confirm({
            title: 'Remove from binder?',
            message: row.card_name,
            confirmText: 'Remove',
            destructive: true,
          });
          if (!ok) return;
          setActionRowId(null);
          await removeCard.mutateAsync(row.id);
        }}
      />

      <Modal
        visible={titleModalOpen}
        transparent
        animationType="none"
        onRequestClose={() => setTitleModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        >
          <SheetCard
            key={titleModalOpen ? 'open' : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.borderStrong,
              borderRadius: theme.radius * 1.5,
              padding: 20,
            }}
          >
            <Eyebrow>Page title</Eyebrow>
            <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>
              Optional — leave blank to clear.
            </Text>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="e.g. Holos"
              placeholderTextColor={theme.textMute}
              autoFocus
              style={{
                backgroundColor: theme.surface2,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                padding: 12, marginTop: 14,
                fontSize: 15, color: theme.text,
                fontFamily: theme.fontUI,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Pressable
                onPress={() => setTitleModalOpen(false)}
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
                onPress={saveTitle}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  backgroundColor: theme.accent,
                  alignItems: 'center',
                }}>
                <Text style={{ color: theme.accentText, fontFamily: theme.fontUIBold, fontSize: 12, textTransform: 'uppercase' }}>
                  Save
                </Text>
              </Pressable>
            </View>
          </SheetCard>
        </KeyboardAvoidingView>
      </Modal>

      <ShareSheet
        open={shareOpen}
        binder={binder ?? null}
        username={myProfile?.username ?? null}
        onClose={() => setShareOpen(false)}
        onChangeVisibility={async (v) => {
          if (!binder) return;
          try {
            await setVisibility.mutateAsync({ binderId: binder.id, visibility: v });
          } catch (e: any) {
            toast.error(e?.message ?? 'Could not change visibility');
          }
        }}
        onCopy={(label, text) => {
          Clipboard.setStringAsync(text);
          toast.success(`${label} copied to clipboard`);
        }}
      />

      <MoveTargetSheet
        rowIds={moveRowIds}
        binders={allBinders.filter((b) => b.id !== id)}
        onClose={() => setMoveRowIds([])}
        onPick={(targetBinderId) => {
          const ids = moveRowIds;
          setMoveRowIds([]);
          moveCards.mutate(
            { rowIds: ids, targetBinderId },
            {
              onSuccess: ({ moved }) => {
                toast.success(`Moved ${moved} ${moved === 1 ? 'card' : 'cards'}`);
                setSelecting(false);
                setSelected(new Set());
              },
              onError: (e: any) => toast.error(e?.message ?? 'Could not move'),
            },
          );
        }}
      />
    </Screen>
  );
}

function pageMenuRowStyle(disabled?: boolean) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    opacity: disabled ? 0.4 : 1,
  };
}

function pageMenuLabelStyle(disabled?: boolean) {
  return {
    color: disabled ? theme.textMute : theme.text,
    fontSize: 15,
    fontFamily: theme.fontUI,
  };
}

function BinderListCards({
  rows, selecting, selected, onTap, onLongPress,
}: {
  rows: CollectionRow[];
  selecting: boolean;
  selected: Set<string>;
  onTap: (row: CollectionRow) => void;
  onLongPress: (row: CollectionRow) => void;
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 6 }}
    >
      {rows.length === 0 ? (
        <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40, fontSize: 13 }}>
          No cards match this filter.
        </Text>
      ) : rows.map((r) => {
        const isSelected = selected.has(r.id);
        const statusColor =
          r.status === 'have' ? theme.statusHave :
          r.status === 'want' ? theme.statusWant : theme.statusReally;
        return (
          <Pressable
            key={r.id}
            onPress={() => onTap(r)}
            onLongPress={() => onLongPress(r)}
            delayLongPress={280}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              padding: 10,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: isSelected ? theme.accent : theme.border,
              borderRadius: theme.radius,
            }}
          >
            {selecting && (
              <Feather
                name={isSelected ? 'check-square' : 'square'}
                size={18}
                color={isSelected ? theme.accent : theme.textMute}
              />
            )}
            {r.image_small ? (
              <Image
                source={{ uri: r.image_small }}
                style={{ width: 40, height: 56, borderRadius: 4, backgroundColor: theme.surface2 }}
              />
            ) : (
              <View style={{ width: 40, height: 56, borderRadius: 4, backgroundColor: theme.surface2 }} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontFamily: theme.fontUI }}>
                {r.card_name}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2 }}>
                {r.set_name} · {r.card_number}{r.condition && r.condition !== 'NM' ? ` · ${r.condition}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: theme.fontMono }}>
                {r.last_price_eur != null ? `€${r.last_price_eur.toFixed(2)}` : '—'}
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function CardActionSheet({
  row, onClose, onInfo, onStatus, onDelete, onMove,
}: {
  row: CollectionRow | null;
  onClose: () => void;
  onInfo: (row: CollectionRow) => void;
  onStatus: (row: CollectionRow, s: Status) => void;
  onDelete: (row: CollectionRow) => void;
  onMove: (row: CollectionRow) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={row !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          backgroundColor: theme.surface,
          borderTopLeftRadius: theme.radius * 2,
          borderTopRightRadius: theme.radius * 2,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.borderStrong,
          paddingHorizontal: 20, paddingTop: 18,
          paddingBottom: 28 + insets.bottom,
        }}>
          <Eyebrow>
            {row?.set_name}{row?.card_number ? ` · ${row.card_number}` : ''}{row?.rarity ? ` · ${row.rarity}` : ''}
          </Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 22, color: theme.text, marginTop: 4, marginBottom: 16,
          }}>{row?.card_name}</Text>

          <Eyebrow style={{ marginBottom: 8 }}>Status</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 18 }}>
            <Chip label="Have"        active={row?.status === 'have'}   color={theme.statusHave}   onPress={() => row && onStatus(row, 'have')} />
            <Chip label="Want"        active={row?.status === 'want'}   color={theme.statusWant}   onPress={() => row && onStatus(row, 'want')} />
            <Chip label="Need" active={row?.status === 'really'} color={theme.statusReally} onPress={() => row && onStatus(row, 'really')} />
          </View>

          <Pressable
            onPress={() => row && onInfo(row)}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: theme.border,
            }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Info</Text>
            <Feather name="chevron-right" size={16} color={theme.textDim} />
          </Pressable>

          <Pressable
            onPress={() => row && onMove(row)}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: theme.border,
            }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Move to binder…</Text>
            <Feather name="chevron-right" size={16} color={theme.textDim} />
          </Pressable>

          <Pressable
            onPress={() => row && onDelete(row)}
            style={{
              paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: theme.border,
            }}>
            <Text style={{ color: theme.statusReally, fontSize: 15 }}>Delete</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MoveTargetSheet({
  rowIds, binders, onClose, onPick,
}: {
  rowIds: string[];
  binders: Binder[];
  onClose: () => void;
  onPick: (binderId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const open = rowIds.length > 0;
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          maxHeight: '60%',
          backgroundColor: theme.surface,
          borderTopLeftRadius: theme.radius * 2,
          borderTopRightRadius: theme.radius * 2,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.borderStrong,
          paddingHorizontal: 20, paddingTop: 18,
          paddingBottom: 24 + insets.bottom,
        }}>
          <Eyebrow>
            Move {rowIds.length} {rowIds.length === 1 ? 'card' : 'cards'} to
          </Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 20, color: theme.text, marginTop: 4, marginBottom: 12,
          }}>Choose a binder</Text>
          <ScrollView>
            {binders.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => onPick(b.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingVertical: 14, paddingHorizontal: 4,
                  borderBottomWidth: 1, borderBottomColor: theme.border,
                }}>
                {b.is_bulk && (
                  <Feather name="package" size={14} color={theme.accent} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{
                    color: theme.text, fontSize: 15, fontFamily: theme.fontUI,
                  }}>{b.name}</Text>
                  <Text style={{
                    fontFamily: theme.fontMono, fontSize: 11,
                    color: theme.textDim, marginTop: 2,
                  }}>
                    {b.is_bulk ? 'Loose cards' : `${b.grid_cols}×${b.grid_rows}`}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.textMute} />
              </Pressable>
            ))}
            {binders.length === 0 && (
              <Text style={{ color: theme.textDim, fontSize: 13, paddingVertical: 16 }}>
                No other binders. Create one to move cards into.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ShareSheet({
  open, binder, username, onClose, onChangeVisibility, onCopy,
}: {
  open: boolean;
  binder: Binder | null;
  username: string | null;
  onClose: () => void;
  onChangeVisibility: (v: 'private' | 'unlisted' | 'public') => void;
  onCopy: (label: string, text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!binder) return null;
  const v = binder.visibility ?? 'private';
  // The mobile app deep-links to /share and /u routes; for the web bundle
  // we use the same paths off the current origin. Falls back to a plain
  // path if there's no window (native).
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : '';
  const shareUrl = binder.share_token ? `${origin}/share/${binder.share_token}` : null;
  const profileUrl = username && v === 'public' ? `${origin}/u/${username}/binder/${binder.id}` : null;

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          backgroundColor: theme.surface,
          borderTopLeftRadius: theme.radius * 2,
          borderTopRightRadius: theme.radius * 2,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.borderStrong,
          paddingHorizontal: 20, paddingTop: 18,
          paddingBottom: 28 + insets.bottom,
        }}>
          <Eyebrow>Share</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 22, color: theme.text, marginTop: 4, marginBottom: 14,
          }}>{binder.name}</Text>

          <VisibilityRow label="Private"  desc="Only you can see this binder."           active={v === 'private'}  onPress={() => onChangeVisibility('private')}  icon="lock" />
          <VisibilityRow label="Unlisted" desc="Anyone with the link can view."           active={v === 'unlisted'} onPress={() => onChangeVisibility('unlisted')} icon="link" />
          <VisibilityRow label="Public"   desc="Listed on your profile, link sharable."   active={v === 'public'}   onPress={() => onChangeVisibility('public')}   icon="globe" />

          {shareUrl && (
            <Pressable
              onPress={() => onCopy('Share link', shareUrl)}
              style={{
                marginTop: 16, padding: 12,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                flexDirection: 'row', alignItems: 'center', gap: 10,
              }}>
              <Feather name="copy" size={14} color={theme.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                  Share link
                </Text>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, fontFamily: theme.fontMono, marginTop: 2 }}>
                  {shareUrl}
                </Text>
              </View>
            </Pressable>
          )}
          {profileUrl && (
            <Pressable
              onPress={() => onCopy('Profile link', profileUrl)}
              style={{
                marginTop: 8, padding: 12,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                flexDirection: 'row', alignItems: 'center', gap: 10,
              }}>
              <Feather name="user" size={14} color={theme.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                  Profile link
                </Text>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, fontFamily: theme.fontMono, marginTop: 2 }}>
                  {profileUrl}
                </Text>
              </View>
            </Pressable>
          )}
          {v === 'public' && !username && (
            <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 10 }}>
              Set a username in your profile to get a /u/&lt;name&gt; link.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function VisibilityRow({
  label, desc, active, onPress, icon,
}: {
  label: string;
  desc: string;
  active: boolean;
  onPress: () => void;
  icon: 'lock' | 'link' | 'globe';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 12, paddingHorizontal: 4,
        borderTopWidth: 1, borderTopColor: theme.border,
      }}>
      <Feather name={icon} size={16} color={active ? theme.accent : theme.textDim} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          color: active ? theme.accent : theme.text,
          fontSize: 14, fontFamily: theme.fontUIBold,
        }}>{label}</Text>
        <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>{desc}</Text>
      </View>
      {active && <Feather name="check" size={16} color={theme.accent} />}
    </Pressable>
  );
}

function ArrowBtn({ dir, disabled, onPress }: { dir: 'left' | 'right'; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.border,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}>
      <Feather name={dir === 'left' ? 'chevron-left' : 'chevron-right'} size={18} color={theme.text} />
    </Pressable>
  );
}

// ─── Page browser ──────────────────────────────────────────────────────
// Full-screen modal that renders every page in the binder as a thumbnail
// "blob." Drag-and-drop on a blob inserts the dragged page at the drop
// target's index (shifting the pages between by one). Each blob has a ⋮
// button that opens a small actions sheet with Rename + Delete.

function PageBrowserModal({
  open, onClose, binder, pages, cardByPos, current, pageCount, slotsPerPage,
  onSelectPage, onReorderPage, onRenamePage, onDeletePage, onAddPage, onMovePage,
}: {
  open: boolean;
  onClose: () => void;
  binder: Binder;
  pages: BinderPage[];
  cardByPos: Map<number, CollectionRow>;
  current: number;
  pageCount: number;
  slotsPerPage: number;
  onSelectPage: (idx: number) => void;
  onReorderPage: (page: BinderPage, toIdx: number) => Promise<void>;
  onRenamePage: (page: BinderPage) => void;
  onDeletePage: (page: BinderPage) => void;
  onAddPage: () => void;
  onMovePage: (page: BinderPage, dir: 'left' | 'right') => void;
}) {
  const insets = useSafeAreaInsets();
  const screenW = clampToContent(Dimensions.get('window').width);
  const SIDE_PAD = 16;
  const BLOB_GAP = 12;
  const COLS_2 = 2;
  const blobW = (screenW - SIDE_PAD * 2 - BLOB_GAP) / COLS_2;
  const cardCols = binder.grid_cols;
  const cardRowsN = binder.grid_rows;
  const BLOB_PAD = 8;
  const HEADER_H = 18;
  const HEADER_GAP = 6;
  const innerW = blobW - BLOB_PAD * 2;
  const cardG = 2;
  const miniCardW = (innerW - cardG * (cardCols - 1)) / cardCols;
  const miniCardH = miniCardW * 1.4;
  const miniGridH = cardRowsN * miniCardH + (cardRowsN - 1) * cardG;
  const blobH = HEADER_H + HEADER_GAP + BLOB_PAD * 2 + miniGridH;

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const [actionsPage, setActionsPage] = useState<BinderPage | null>(null);

  // Mirrors of the React state for the UI-thread worklets — gesture callbacks
  // run on the UI thread now and can't read React state directly, so the
  // shared values are the source of truth during the drag and the React state
  // setters are called via runOnJS only when the state actually changes.
  const dragIdxSV = useSharedValue<number | null>(null);
  const hoverIdxSV = useSharedValue<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  dragIdxRef.current = dragIdx;
  const hoverIdxRef = useRef<number | null>(null);
  hoverIdxRef.current = hoverIdx;

  // Auto-scroll while reordering: when the finger sits near the top/bottom
  // of the scroll viewport during a drag, scroll the page list automatically.
  //
  // Implementation note: the earlier version drove this with a JS-thread
  // setInterval calling ScrollView.scrollTo, which contended with React
  // re-renders from setHoverIdx and felt visibly laggy. Now everything that
  // ticks during the drag runs on the UI thread:
  //   - useAnimatedScrollHandler keeps scrollYSV in sync with the native
  //     scroll offset (UI thread, no JS bridge).
  //   - useFrameCallback runs every UI-thread frame and calls the Reanimated
  //     scrollTo() worklet, which scrolls natively without touching JS.
  //   - The JS-thread gesture only writes direction + speed shared values.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollYSV = useSharedValue(0);
  const viewportHSV = useSharedValue(0);
  const contentHSV = useSharedValue(0);
  const autoScrollDirSV = useSharedValue<-1 | 0 | 1>(0);
  const autoScrollSpeedSV = useSharedValue(24);
  useFrameCallback(() => {
    'worklet';
    if (autoScrollDirSV.value === 0) return;
    const maxScroll = Math.max(0, contentHSV.value - viewportHSV.value);
    const next = Math.max(
      0,
      Math.min(maxScroll, scrollYSV.value + autoScrollDirSV.value * autoScrollSpeedSV.value),
    );
    if (next === scrollYSV.value) return;
    scrollTo(scrollRef, 0, next, false);
    // Update SV ourselves rather than waiting for onScroll to round-trip:
    // useAnimatedScrollHandler fires after the native scroll event lands,
    // which can be a frame behind. Without this, the next frame computes
    // its "next" position against a stale base and visibly stutters.
    scrollYSV.value = next;
    // No need to compensate dragY for scroll — the overlay now lives
    // OUTSIDE the ScrollView and renders at screen-absolute coordinates,
    // so the scroll doesn't move it.
  }, true);
  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollYSV.value = e.contentOffset.y; },
  });
  const PAGE_AUTOSCROLL_ZONE = 140;

  const panGesture = useMemo(() => {
    const pagesLen = pages.length;
    // JS handlers — invoked via runOnJS from the worklet callbacks. Captured
    // in the useMemo closure so they always see the latest `pages` and
    // `onReorderPage`. setDragIdx/setHoverIdx are stable React setters.
    const onStartJS = (idx: number) => {
      setDragIdx(idx);
      setHoverIdx(idx);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    const onHoverChangeJS = (idx: number | null) => {
      setHoverIdx(idx);
    };
    const onEndJS = (d: number, h: number | null) => {
      setDragIdx(null);
      setHoverIdx(null);
      if (h !== null && d !== h) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const page = pages[d];
        if (page) onReorderPage(page, h);
      }
    };
    const onFinalizeJS = () => {
      setDragIdx(null);
      setHoverIdx(null);
    };
    return Gesture.Pan()
      .activateAfterLongPress(300)
      // No .runOnJS(true) — callbacks run as worklets on the UI thread so the
      // drag position and auto-scroll trigger update every frame even when
      // the JS thread is busy with renders.
      .onStart((e) => {
        'worklet';
        // Inline blobAt — closures over pagesLen captured above.
        const col = Math.floor(e.x / (blobW + BLOB_GAP));
        if (col < 0 || col >= COLS_2) return;
        const row = Math.floor(e.y / (blobH + BLOB_GAP));
        if (row < 0) return;
        const idx = row * COLS_2 + col;
        if (idx < 0 || idx >= pagesLen) return;
        dragIdxSV.value = idx;
        hoverIdxSV.value = idx;
        // Overlay sits outside the ScrollView and renders at screen
        // coordinates — absoluteX/Y stay correct as content scrolls.
        dragX.value = e.absoluteX;
        dragY.value = e.absoluteY;
        runOnJS(onStartJS)(idx);
      })
      .onUpdate((e) => {
        'worklet';
        if (dragIdxSV.value === null) return;
        dragX.value = e.absoluteX;
        dragY.value = e.absoluteY;
        // Inline blobAt
        let idx: number | null = null;
        const col = Math.floor(e.x / (blobW + BLOB_GAP));
        if (col >= 0 && col < COLS_2) {
          const row = Math.floor(e.y / (blobH + BLOB_GAP));
          if (row >= 0) {
            const i = row * COLS_2 + col;
            if (i >= 0 && i < pagesLen) idx = i;
          }
        }
        if (idx !== hoverIdxSV.value) {
          hoverIdxSV.value = idx;
          runOnJS(onHoverChangeJS)(idx);
        }
        const viewportH = viewportHSV.value;
        const contentH = contentHSV.value;
        if (viewportH <= 0) {
          autoScrollDirSV.value = 0;
          return;
        }
        const maxScroll = Math.max(0, contentH - viewportH);
        const viewportTop = scrollYSV.value;
        const viewportBottom = viewportTop + viewportH;
        const canScrollUp = viewportTop > 0.5;
        const canScrollDown = viewportTop < maxScroll - 0.5;
        const inTopZone = canScrollUp && e.y < viewportTop + PAGE_AUTOSCROLL_ZONE;
        const inBottomZone = canScrollDown && e.y > viewportBottom - PAGE_AUTOSCROLL_ZONE;
        if (inTopZone || inBottomZone) {
          const depth = inBottomZone
            ? Math.min(1, (e.y - (viewportBottom - PAGE_AUTOSCROLL_ZONE)) / PAGE_AUTOSCROLL_ZONE)
            : Math.min(1, ((viewportTop + PAGE_AUTOSCROLL_ZONE) - e.y) / PAGE_AUTOSCROLL_ZONE);
          autoScrollSpeedSV.value = 6 + Math.max(0, depth) * 12;
          autoScrollDirSV.value = inBottomZone ? 1 : -1;
        } else {
          autoScrollDirSV.value = 0;
        }
      })
      .onEnd(() => {
        'worklet';
        autoScrollDirSV.value = 0;
        const d = dragIdxSV.value;
        const h = hoverIdxSV.value;
        dragIdxSV.value = null;
        hoverIdxSV.value = null;
        if (d !== null) runOnJS(onEndJS)(d, h);
      })
      .onFinalize(() => {
        'worklet';
        autoScrollDirSV.value = 0;
        if (dragIdxSV.value !== null) {
          dragIdxSV.value = null;
          hoverIdxSV.value = null;
          runOnJS(onFinalizeJS)();
        }
      });
  }, [blobW, blobH, BLOB_GAP, pages, onReorderPage]);

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value - blobW / 2 },
      { translateY: dragY.value - blobH / 2 },
    ],
  }));

  // +1 slot for the trailing "add page" blob.
  const totalH = Math.ceil((pages.length + 1) / COLS_2) * (blobH + BLOB_GAP);

  return (
    <Modal
      visible={open}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
        <Screen edges={['top']}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6,
          }}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={theme.textDim} />
            </Pressable>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 12, color: theme.text,
              letterSpacing: 1.5, textTransform: 'uppercase',
            }}>Pages · {pageCount}</Text>
            <Pressable onPress={onAddPage} hitSlop={12}>
              <Feather name="plus" size={22} color={theme.accent} />
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: 10 }}>
            <Text style={{
              color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono,
              letterSpacing: 1, textTransform: 'uppercase',
            }}>Tap to open · hold &amp; drag to reorder</Text>
          </View>

          <Animated.ScrollView
            ref={scrollRef}
            contentContainerStyle={{ paddingHorizontal: SIDE_PAD, paddingBottom: 40 + insets.bottom, paddingTop: 6 }}
            scrollEnabled={dragIdx === null}
            onLayout={(e) => { viewportHSV.value = e.nativeEvent.layout.height; }}
            onContentSizeChange={(_w, h) => { contentHSV.value = h; }}
            // scrollEnabled={false} doesn't block Reanimated's scrollTo
            // worklet, so auto-scroll still works during drag. The animated
            // scroll handler keeps scrollYSV in sync on the UI thread.
            onScroll={animatedScrollHandler}
            scrollEventThrottle={16}
          >
            <GestureDetector gesture={panGesture}>
              <View style={{ width: COLS_2 * blobW + BLOB_GAP, height: totalH, position: 'relative' }}>
                {pages.map((page, idx) => {
                  const col = idx % COLS_2;
                  const row = Math.floor(idx / COLS_2);
                  const isCur = idx === current;
                  const isDrag = idx === dragIdx;
                  const isHover = idx === hoverIdx && dragIdx !== null && dragIdx !== idx;
                  return (
                    <View key={page.id} style={{
                      position: 'absolute',
                      left: col * (blobW + BLOB_GAP),
                      top: row * (blobH + BLOB_GAP),
                      width: blobW, height: blobH,
                    }}>
                      <PageBlob
                        p={idx}
                        pageTitle={page.title}
                        blobW={blobW}
                        blobH={blobH}
                        innerW={innerW}
                        cardCols={cardCols}
                        cardRowsN={cardRowsN}
                        slotsPerPage={slotsPerPage}
                        miniCardW={miniCardW}
                        miniCardH={miniCardH}
                        miniGridH={miniGridH}
                        cardG={cardG}
                        blobPad={BLOB_PAD}
                        headerH={HEADER_H}
                        headerGap={HEADER_GAP}
                        cardByPos={cardByPos}
                        isCurrent={isCur}
                        isDragged={isDrag}
                        isHovered={isHover}
                        onTap={() => onSelectPage(idx)}
                        onMenuPress={() => setActionsPage(page)}
                      />
                    </View>
                  );
                })}
                {/* Trailing "+ Add page" blob. blobAt() rejects this index so
                    a long-press here doesn't try to drag/reorder. */}
                {(() => {
                  const addIdx = pages.length;
                  const col = addIdx % COLS_2;
                  const row = Math.floor(addIdx / COLS_2);
                  return (
                    <View key="add-blob" style={{
                      position: 'absolute',
                      left: col * (blobW + BLOB_GAP),
                      top: row * (blobH + BLOB_GAP),
                      width: blobW, height: blobH,
                    }}>
                      <Pressable
                        onPress={onAddPage}
                        style={{
                          width: blobW, height: blobH,
                          borderRadius: theme.radius,
                          borderWidth: 1,
                          borderStyle: 'dashed',
                          borderColor: theme.borderStrong,
                          backgroundColor: theme.surface,
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                        }}>
                        <Feather name="plus" size={28} color={theme.accent} />
                        <Text style={{
                          color: theme.accent, fontFamily: theme.fontUIBold,
                          fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                        }}>
                          Add page
                        </Text>
                      </Pressable>
                    </View>
                  );
                })()}
              </View>
            </GestureDetector>
          </Animated.ScrollView>

          {/* Dragged blob overlay — rendered OUTSIDE the ScrollView so it
              sits at screen-absolute coordinates and doesn't move when the
              auto-scroll fires. dragX/dragY are populated from the gesture's
              absoluteX/absoluteY, so translate(dragX − blobW/2, dragY − blobH/2)
              centers the blob on the finger regardless of scroll position. */}
          {dragIdx !== null && pages[dragIdx] && (
            <Animated.View
              pointerEvents="none"
              style={[{
                position: 'absolute', left: 0, top: 0,
                width: blobW, height: blobH, zIndex: 100, opacity: 0.92,
              }, overlayStyle]}
            >
              <PageBlob
                p={dragIdx}
                pageTitle={pages[dragIdx]?.title}
                blobW={blobW}
                blobH={blobH}
                innerW={innerW}
                cardCols={cardCols}
                cardRowsN={cardRowsN}
                slotsPerPage={slotsPerPage}
                miniCardW={miniCardW}
                miniCardH={miniCardH}
                miniGridH={miniGridH}
                cardG={cardG}
                blobPad={BLOB_PAD}
                headerH={HEADER_H}
                headerGap={HEADER_GAP}
                cardByPos={cardByPos}
                isCurrent={false}
                isDragged={false}
                isHovered={false}
              />
            </Animated.View>
          )}

          <PageActionsSheet
            page={actionsPage}
            canDelete={pageCount > 1}
            canMoveLeft={actionsPage != null && actionsPage.page_index > 0}
            canMoveRight={actionsPage != null && actionsPage.page_index < pageCount - 1}
            onClose={() => setActionsPage(null)}
            onRename={(p) => { setActionsPage(null); onRenamePage(p); }}
            onDelete={(p) => { setActionsPage(null); onDeletePage(p); }}
            onMoveLeft={(p) => { setActionsPage(null); onMovePage(p, 'left'); }}
            onMoveRight={(p) => { setActionsPage(null); onMovePage(p, 'right'); }}
          />
        </Screen>
      </GestureHandlerRootView>
    </Modal>
  );
}

function PageBlob({
  p, pageTitle, blobW, blobH, innerW,
  cardCols, cardRowsN, slotsPerPage,
  miniCardW, miniCardH, miniGridH, cardG,
  blobPad, headerH, headerGap,
  cardByPos, isCurrent, isDragged, isHovered,
  onTap, onMenuPress,
}: {
  p: number;
  pageTitle?: string | null;
  blobW: number;
  blobH: number;
  innerW: number;
  cardCols: number;
  cardRowsN: number;
  slotsPerPage: number;
  miniCardW: number;
  miniCardH: number;
  miniGridH: number;
  cardG: number;
  blobPad: number;
  headerH: number;
  headerGap: number;
  cardByPos: Map<number, CollectionRow>;
  isCurrent: boolean;
  isDragged: boolean;
  isHovered: boolean;
  onTap?: () => void;
  onMenuPress?: () => void;
}) {
  const start = p * slotsPerPage;
  return (
    <Pressable
      onPress={onTap}
      disabled={!onTap}
      style={{
        width: blobW, height: blobH,
        backgroundColor: theme.surface,
        borderRadius: theme.radius,
        borderWidth: isCurrent || isHovered ? 2 : 1,
        borderColor: isHovered ? theme.accent : isCurrent ? theme.accent : theme.border,
        padding: blobPad,
        opacity: isDragged ? 0.25 : 1,
      }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: headerH, marginBottom: headerGap,
      }}>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: theme.fontMono, fontSize: 10, letterSpacing: 1.5,
            color: isCurrent ? theme.accent : theme.textDim,
            textTransform: 'uppercase',
          }}>
          {String(p + 1).padStart(2, '0')}{pageTitle ? ` · ${pageTitle}` : ''}
        </Text>
        {onMenuPress && (
          <Pressable onPress={onMenuPress} hitSlop={6} style={{ paddingLeft: 6 }}>
            <Feather name="more-vertical" size={14} color={theme.textDim} />
          </Pressable>
        )}
      </View>
      <View style={{ width: innerW, height: miniGridH, position: 'relative' }}>
        {Array.from({ length: slotsPerPage }).map((_, i) => {
          const card = cardByPos.get(start + i);
          const col = i % cardCols;
          const row = Math.floor(i / cardCols);
          return (
            <View key={i} style={{
              position: 'absolute',
              left: col * (miniCardW + cardG),
              top: row * (miniCardH + cardG),
              width: miniCardW, height: miniCardH,
              borderRadius: 1.5,
              backgroundColor: theme.surface2,
              overflow: 'hidden',
            }}>
              {card?.image_small ? (
                <Image
                  source={{ uri: card.image_small }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

function PageActionsSheet({
  page, canDelete, canMoveLeft, canMoveRight,
  onClose, onRename, onDelete, onMoveLeft, onMoveRight,
}: {
  page: BinderPage | null;
  canDelete: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onClose: () => void;
  onRename: (p: BinderPage) => void;
  onDelete: (p: BinderPage) => void;
  onMoveLeft: (p: BinderPage) => void;
  onMoveRight: (p: BinderPage) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={page !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          backgroundColor: theme.surface,
          borderTopLeftRadius: theme.radius * 2,
          borderTopRightRadius: theme.radius * 2,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.borderStrong,
          paddingHorizontal: 20, paddingTop: 18,
          paddingBottom: 28 + insets.bottom,
        }}>
          <Eyebrow>Page {page ? String(page.page_index + 1).padStart(2, '0') : '--'}</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 22, color: theme.text, marginTop: 4, marginBottom: 16,
          }}>{page?.title || 'Untitled page'}</Text>

          <Pressable
            onPress={() => page && onRename(page)}
            style={pageMenuRowStyle()}>
            <Text style={pageMenuLabelStyle()}>
              {page?.title ? 'Rename page' : '+ Page title'}
            </Text>
            <Feather name="edit-3" size={14} color={theme.textDim} />
          </Pressable>

          <Pressable
            onPress={() => page && onMoveLeft(page)}
            disabled={!canMoveLeft}
            style={pageMenuRowStyle(!canMoveLeft)}>
            <Text style={pageMenuLabelStyle(!canMoveLeft)}>Move page left</Text>
            <Feather name="chevron-left" size={14} color={canMoveLeft ? theme.textDim : theme.textMute} />
          </Pressable>

          <Pressable
            onPress={() => page && onMoveRight(page)}
            disabled={!canMoveRight}
            style={pageMenuRowStyle(!canMoveRight)}>
            <Text style={pageMenuLabelStyle(!canMoveRight)}>Move page right</Text>
            <Feather name="chevron-right" size={14} color={canMoveRight ? theme.textDim : theme.textMute} />
          </Pressable>

          <Pressable
            onPress={() => page && onDelete(page)}
            disabled={!canDelete}
            style={pageMenuRowStyle(!canDelete)}>
            <Text style={[pageMenuLabelStyle(!canDelete), { color: canDelete ? theme.statusReally : theme.textMute }]}>
              Delete page
            </Text>
            <Feather name="trash-2" size={14} color={canDelete ? theme.statusReally : theme.textMute} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
