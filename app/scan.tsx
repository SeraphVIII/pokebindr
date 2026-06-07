// Scan — point the camera at a card, identify it.
//
// Flow: live camera with a card-shaped guide → capture → crop to the guide,
// downscale to ~1600px + base64 → card-scan Edge Function (OCR + TCGdex) → ranked
// candidate sheet. Tapping a candidate then either:
//   • opens /card/[id] (global flow), or
//   • upserts directly into a binder slot when this screen was opened from an
//     in-binder lookup — binderId / position are forwarded as query params by
//     lookup.tsx, and we mirror useUpsertCard + router.back() so the user lands
//     back in the binder. Each scan candidate already carries a full TcgCard
//     (the edge function enriches the top hits), so no extra fetch is needed.
//
// Top-level route (not a tab) so the camera is full-bleed and the six-tab
// bar stays put. Opened from the camera button on the Add screen.

import { useRef, useState } from 'react';
import {
  View, Text, Pressable, Image, ActivityIndicator, ScrollView, StyleSheet,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Eyebrow } from '@/components/Eyebrow';
import { useScanCard, useUpsertCard, ScanCandidate, ScanResult } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';

// Trading-card aspect ratio (63mm × 88mm ≈ 0.716). The guide frame nudges
// the user to fill it, which keeps the collector number + name in view.
const CARD_RATIO = 63 / 88;
// Guide width as a fraction of the camera viewport. Must stay in sync with
// sx.guide.width below — it's used both to draw the frame and to crop to it.
const GUIDE_FRAC = 0.72;

/** Map the on-screen guide rectangle to pixel coordinates in the captured
 *  photo, then return an ImageManipulator crop. The camera preview fills the
 *  viewport "cover"-style (scaled up, edges clipped), so a fraction of the
 *  screen is NOT the same fraction of the photo — we undo that scale here.
 *  Cropping to the guide is what stops slab labels / surroundings outside the
 *  frame from reaching OCR. */
function computeCrop(sw: number, sh: number, pw: number, ph: number) {
  const screenPortrait = sh >= sw;
  const photoPortrait = ph >= pw;
  if (sw > 0 && sh > 0 && screenPortrait === photoPortrait) {
    const s = Math.max(sw / pw, sh / ph); // cover scale
    const offX = (sw - pw * s) / 2;
    const offY = (sh - ph * s) / 2;
    const gw = sw * GUIDE_FRAC;
    const gh = gw / CARD_RATIO;
    const gx = (sw - gw) / 2;
    const gy = (sh - gh) / 2;
    const x = Math.max(0, (gx - offX) / s);
    const y = Math.max(0, (gy - offY) / s);
    return {
      originX: Math.round(x),
      originY: Math.round(y),
      width: Math.round(Math.min(gw / s, pw - x)),
      height: Math.round(Math.min(gh / s, ph - y)),
    };
  }
  // Orientation mismatch (rare) — fall back to a centered card-shaped crop.
  let h = ph * 0.92;
  let w = h * CARD_RATIO;
  if (w > pw) { w = pw * 0.92; h = w / CARD_RATIO; }
  return {
    originX: Math.round((pw - w) / 2),
    originY: Math.round((ph - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  };
}

export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const scan = useScanCard();
  // Forwarded by lookup.tsx when scan is opened from an empty binder slot.
  // binderId presence is what flips this screen from "preview → /card/[id]"
  // into "preview → upsert → land back on /binder/[id]". `page` is threaded
  // through so the binder reopens to the same page the user tapped from.
  const { binderId, position, page } = useLocalSearchParams<{
    binderId?: string;
    position?: string;
    page?: string;
  }>();
  const positionOverride = position != null ? parseInt(position, 10) : undefined;
  const upsert = useUpsertCard();
  const toast = useToast();

  const [preview, setPreview] = useState<string | null>(null); // captured frame uri
  const [result, setResult] = useState<ScanResult | null>(null);
  // Viewport size, measured — needed to map the guide rect onto the photo.
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  // Which candidate is mid-upsert (in-binder flow only); guards against double
  // taps and lets the results sheet show progress on the right row.
  const [addingId, setAddingId] = useState<string | null>(null);

  const capture = async () => {
    if (!cameraRef.current || scan.isPending) return;
    try {
      // shutterSound: false silences the iOS / Android system shutter chirp —
      // unnecessary feedback when the user is already framing in our own UI,
      // and disruptive in quiet environments.
      const shot = await cameraRef.current.takePictureAsync({ quality: 1, shutterSound: false });
      if (!shot?.uri) return;
      setPreview(shot.uri);
      // Crop to the guide rectangle so only the framed card reaches OCR —
      // this is what excludes a graded slab's label text. Then resize to a
      // generous 1600px and use a high JPEG quality: the title text is small,
      // and aggressive downscale/compression turns "Hisuian" into "Hisulan"
      // (the i↔l confusion). More pixels + fewer artefacts fixes that.
      const actions: ImageManipulator.Action[] = [];
      if (viewport && shot.width && shot.height) {
        const crop = computeCrop(viewport.width, viewport.height, shot.width, shot.height);
        if (crop.width > 0 && crop.height > 0) actions.push({ crop });
      }
      actions.push({ resize: { width: 1600 } });
      const manip = await ImageManipulator.manipulateAsync(
        shot.uri,
        actions,
        { compress: 0.92, base64: true, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (!manip.base64) throw new Error('Could not encode image');
      const res = await scan.mutateAsync(manip.base64);
      setResult(res);
    } catch (e) {
      setResult({
        candidates: [],
        parsed: { name: '' },
        ocrText: (e as Error).message ?? 'Scan failed',
      });
    }
  };

  const retake = () => {
    setPreview(null);
    setResult(null);
    scan.reset();
  };

  // ── Permission states ───────────────────────────────────────
  if (!permission) {
    return (
      <View style={sx.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={[sx.center, { padding: 32 }]}>
        <Feather name="camera-off" size={28} color={theme.textDim} />
        <Text style={sx.permTitle}>Camera access needed</Text>
        <Text style={sx.permBody}>
          To scan and identify cards, allow camera access.
        </Text>
        <Pressable onPress={requestPermission} style={sx.primaryBtn}>
          <Text style={sx.primaryBtnText}>Grant access</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginTop: 16 }}>
          <Text style={{ color: theme.textDim, fontSize: 13 }}>Not now</Text>
        </Pressable>
      </View>
    );
  }

  const busy = scan.isPending;

  return (
    <View
      style={{ flex: 1, backgroundColor: '#000' }}
      onLayout={(e) => setViewport(e.nativeEvent.layout)}
    >
      {/* Frozen frame while scanning / showing results; live camera otherwise */}
      {preview ? (
        <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      )}

      {/* Card-shaped guide overlay (only while framing) */}
      {!preview && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, sx.guideWrap]}>
          <View style={sx.guide} />
          <Text style={sx.guideHint}>Fill the frame with one card</Text>
        </View>
      )}

      {/* Close button */}
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={[sx.closeBtn, { top: insets.top + 8 }]}
      >
        <Feather name="x" size={22} color="#fff" />
      </Pressable>

      {/* Scanning spinner */}
      {busy && (
        <View style={[StyleSheet.absoluteFill, sx.scanningOverlay]}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={sx.scanningText}>Identifying…</Text>
        </View>
      )}

      {/* Capture button (framing state) */}
      {!preview && !busy && (
        <View style={[sx.captureBar, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={capture} style={sx.shutter}>
            <View style={sx.shutterInner} />
          </Pressable>
        </View>
      )}

      {/* Results sheet */}
      {result && !busy && (
        <ResultsSheet
          result={result}
          inBinder={!!binderId}
          addingId={addingId}
          onPick={async (c) => {
            // Global flow: hand off to the card detail screen, which owns the
            // existing add-to-binder UI. router.replace (not push) so the
            // scan screen is removed from the back stack — pressing back from
            // the detail screen returns to whatever opened scan (lookup tab,
            // etc.) instead of bouncing through scan first.
            if (!binderId) {
              router.replace(result.locale === 'ja' ? `/card/${c.card.id}?lang=ja` : `/card/${c.card.id}`);
              return;
            }
            // In-binder flow: upsert into the slot, then navigate straight to
            // the binder. We can't use dismiss(N) here — /scan sits on the
            // root stack but /lookup is a tab, so they aren't on the same
            // stack to pop together. router.replace cross-navigator gets
            // expo-router to drop /scan AND switch the active tab back to
            // Binder in one motion, landing the user on the exact page they
            // tapped from.
            if (addingId) return;
            setAddingId(c.card.id);
            try {
              await upsert.mutateAsync({
                card: c.card,
                status: 'have',
                binderId,
                position: Number.isFinite(positionOverride) ? positionOverride : undefined,
              });
              router.replace({
                pathname: '/binder/[id]',
                params: { id: binderId, ...(page ? { page } : null) },
              });
            } catch (e: any) {
              toast.error(e.message ?? 'Could not add card');
            } finally {
              setAddingId(null);
            }
          }}
          onRetake={retake}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

function ResultsSheet({
  result, inBinder, addingId, onPick, onRetake, bottomInset,
}: {
  result: ScanResult;
  inBinder: boolean;
  addingId: string | null;
  onPick: (c: ScanCandidate) => void;
  onRetake: () => void;
  bottomInset: number;
}) {
  const { candidates, parsed } = result;
  return (
    <View style={[sx.sheet, { paddingBottom: bottomInset + 16 }]}>
      <View style={sx.sheetHandle} />
      {inBinder && (
        <Text style={sx.inBinderHint}>Adding to current binder</Text>
      )}
      {candidates.length > 0 ? (
        <>
          <Eyebrow>
            {candidates.length} match{candidates.length > 1 ? 'es' : ''}
            {parsed.name ? ` · read “${parsed.name}”` : ''}
          </Eyebrow>
          <ScrollView style={{ maxHeight: 320, marginTop: 10 }}>
            {candidates.map((c, i) => {
              const adding = addingId === c.card.id;
              return (
                <Pressable
                  key={`${c.card.id}-${i}`}
                  onPress={() => onPick(c)}
                  disabled={!!addingId}
                  style={[
                    sx.row,
                    i === 0 && sx.rowTop,
                    { opacity: addingId && !adding ? 0.4 : 1 },
                  ]}
                >
                  {c.card.images.small ? (
                    <Image source={{ uri: c.card.images.small }} style={sx.thumb} />
                  ) : (
                    <View style={[sx.thumb, { backgroundColor: theme.surface2 }]} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={sx.rowName} numberOfLines={1}>{c.card.name}</Text>
                    <Text style={sx.rowMeta} numberOfLines={1}>
                      {c.card.set.name} · {c.card.number}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[
                      sx.confidence,
                      { color: c.confidence >= 0.7 ? theme.statusHave : theme.textDim },
                    ]}>
                      {Math.round(c.confidence * 100)}%
                    </Text>
                    {adding
                      ? <ActivityIndicator size="small" color={theme.accent} />
                      : <Feather name="chevron-right" size={16} color={theme.textMute} />}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : (
        <View style={{ paddingVertical: 12 }}>
          <Eyebrow>No match</Eyebrow>
          <Text style={sx.noMatch}>
            {parsed.name
              ? `Read “${parsed.name}” but found no card. Try better lighting or fill the frame.`
              : 'Couldn’t read the card. Hold steady, fill the frame, and avoid glare.'}
          </Text>
        </View>
      )}

      <Pressable onPress={onRetake} style={sx.retakeBtn}>
        <Feather name="rotate-ccw" size={15} color={theme.accent} />
        <Text style={sx.retakeText}>Scan again</Text>
      </Pressable>
    </View>
  );
}

const sx = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: theme.bg,
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: 12,
  },
  permTitle: {
    color: theme.text, fontSize: 18, fontFamily: theme.fontDisplay, marginTop: 8,
  },
  permBody: {
    color: theme.textDim, fontSize: 13, textAlign: 'center' as const, lineHeight: 19,
  },
  primaryBtn: {
    marginTop: 8, backgroundColor: theme.accent,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: theme.radius,
  },
  primaryBtnText: {
    color: theme.accentText, fontFamily: theme.fontUIBold, fontSize: 14,
  },
  guideWrap: { alignItems: 'center' as const, justifyContent: 'center' as const },
  guide: {
    width: '72%', aspectRatio: CARD_RATIO,
    borderWidth: 2, borderColor: 'rgba(212,175,55,0.85)',
    borderRadius: 12,
  },
  guideHint: {
    color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 16,
    fontFamily: theme.fontMono, letterSpacing: 0.5,
  },
  closeBtn: {
    position: 'absolute' as const, right: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scanningOverlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: 14,
  },
  scanningText: {
    color: '#fff', fontFamily: theme.fontMono, fontSize: 13, letterSpacing: 1,
  },
  captureBar: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    alignItems: 'center' as const,
  },
  shutter: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  shutterInner: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff',
  },
  sheet: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radius * 2, borderTopRightRadius: theme.radius * 2,
    borderTopWidth: 1, borderColor: theme.borderStrong,
    paddingHorizontal: 20, paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center' as const, width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.border, marginBottom: 12,
  },
  inBinderHint: {
    color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono,
    letterSpacing: 1.5, textTransform: 'uppercase' as const,
    paddingHorizontal: 4, paddingBottom: 8,
  },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  rowTop: {},
  thumb: {
    width: 40, height: 56, borderRadius: 4, backgroundColor: theme.surface2,
  },
  rowName: { color: theme.text, fontSize: 15, fontWeight: '500' as const },
  rowMeta: {
    color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2,
  },
  confidence: {
    fontSize: 13, fontFamily: theme.fontMono, fontWeight: '600' as const,
  },
  noMatch: {
    color: theme.textDim, fontSize: 13, lineHeight: 20, marginTop: 8,
  },
  retakeBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, marginTop: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radius,
  },
  retakeText: {
    color: theme.accent, fontFamily: theme.fontUIBold, fontSize: 13,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
});
