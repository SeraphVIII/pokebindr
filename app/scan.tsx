// Scan — point the camera at a card, identify it.

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

// Trading-card aspect ratio (63mm × 88mm).
const CARD_RATIO = 63 / 88;
// Guide width as a fraction of the camera viewport. Must stay in sync with
// sx.guide.width below; used both to draw the frame and to crop to it.
const GUIDE_FRAC = 0.72;

/** Maps the on-screen guide rectangle to pixel coordinates in the captured
 *  photo. The camera preview fills the viewport cover-style, so a fraction
 *  of the screen is not the same fraction of the photo. */
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
  // Forwarded by lookup.tsx. binderId switches the flow from opening
  // /card/[id] to upserting into the binder slot; `page` restores the page.
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
      const shot = await cameraRef.current.takePictureAsync({ quality: 1, shutterSound: false });
      if (!shot?.uri) return;
      setPreview(shot.uri);
      // Crop to the guide so only the framed card reaches OCR. Keep size and
      // JPEG quality generous; aggressive downscaling garbles the title text.
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
      {preview ? (
        <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      )}

      {!preview && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, sx.guideWrap]}>
          <View style={sx.guide} />
          <Text style={sx.guideHint}>Fill the frame with one card</Text>
        </View>
      )}

      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={[sx.closeBtn, { top: insets.top + 8 }]}
      >
        <Feather name="x" size={22} color="#fff" />
      </Pressable>

      {busy && (
        <View style={[StyleSheet.absoluteFill, sx.scanningOverlay]}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={sx.scanningText}>Identifying…</Text>
        </View>
      )}

      {!preview && !busy && (
        <View style={[sx.captureBar, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={capture} style={sx.shutter}>
            <View style={sx.shutterInner} />
          </Pressable>
        </View>
      )}

      {result && !busy && (
        <ResultsSheet
          result={result}
          inBinder={!!binderId}
          addingId={addingId}
          onPick={async (c) => {
            // Global flow: hand off to the card detail screen. replace (not
            // push) removes the scan screen from the back stack.
            if (!binderId) {
              router.replace(result.locale === 'ja' ? `/card/${c.card.id}?lang=ja` : `/card/${c.card.id}`);
              return;
            }
            // In-binder flow: /scan is on the root stack and /lookup is a tab,
            // so a cross-navigator replace drops /scan and switches tabs at once.
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
    color: theme.text, fontSize: 20, fontFamily: theme.fontDisplaySemi, marginTop: 8,
  },
  permBody: {
    color: theme.textDim, fontSize: 13, fontFamily: theme.fontUI,
    textAlign: 'center' as const, lineHeight: 19,
  },
  primaryBtn: {
    marginTop: 12, backgroundColor: theme.accent,
    paddingHorizontal: 26, paddingVertical: 13, borderRadius: theme.pill,
    boxShadow: theme.shadowGold,
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
    borderTopLeftRadius: theme.radiusXl, borderTopRightRadius: theme.radiusXl,
    borderTopWidth: 1, borderColor: theme.hairline,
    paddingHorizontal: 20, paddingTop: 10,
    boxShadow: theme.shadowInner,
  },
  sheetHandle: {
    alignSelf: 'center' as const, width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.glassStrong, marginBottom: 12,
  },
  inBinderHint: {
    color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono,
    letterSpacing: 1.5, textTransform: 'uppercase' as const,
    paddingHorizontal: 4, paddingBottom: 8,
  },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.hairline,
  },
  rowTop: {},
  thumb: {
    width: 40, height: 56, borderRadius: 6, backgroundColor: theme.surface2,
  },
  rowName: { color: theme.text, fontSize: 15, fontFamily: theme.fontUIBold },
  rowMeta: {
    color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2,
  },
  confidence: {
    fontSize: 13, fontFamily: theme.fontMono,
  },
  noMatch: {
    color: theme.textDim, fontSize: 13, fontFamily: theme.fontUI,
    lineHeight: 20, marginTop: 8,
  },
  retakeBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, marginTop: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.pill,
    backgroundColor: theme.glass,
  },
  retakeText: {
    color: theme.accent, fontFamily: theme.fontUIBold, fontSize: 13,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
});
