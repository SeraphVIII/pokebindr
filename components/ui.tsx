// Shared UI primitives: pressables, surfaces, buttons, skeletons, and chrome.

import { PropsWithChildren, useEffect } from 'react';
import {
  Platform, Pressable, PressableProps, Text, View, ViewStyle, StyleProp, TextStyle,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  withRepeat, withSequence, Easing,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function tapFeedback() {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

// ── PressableScale ──────────────────────────────────────────────────────
// Spring scale-down pressable with a light haptic tick; wraps Pressable 1:1.

interface PressableScaleProps extends PressableProps {
  scaleTo?: number;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PressableScale({
  children, scaleTo = 0.97, haptic = true, style, onPressIn, onPressOut, onPress, ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 22, stiffness: 380 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 18, stiffness: 280 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tapFeedback();
        onPress?.(e);
      }}
      style={[aStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ── Bezel ───────────────────────────────────────────────────────────────
// Double-bezel tray: outer shell holding an inner core. Radii stay
// concentric (inner = outer - pad).

interface BezelProps extends PropsWithChildren {
  radius?: number;
  pad?: number;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  innerColor?: string;
  glow?: boolean;
}

export function Bezel({
  children, radius = theme.radiusLg, pad = 5, style, innerStyle,
  innerColor = theme.surface, glow = false,
}: BezelProps) {
  return (
    <View
      style={[{
        backgroundColor: theme.shell,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: radius,
        padding: pad,
        boxShadow: glow ? theme.shadowGold : theme.shadowAmbient,
      }, style]}
    >
      <View
        style={[{
          backgroundColor: innerColor,
          borderRadius: radius - pad,
          borderWidth: 1,
          borderColor: theme.hairline,
          boxShadow: theme.shadowInner,
          overflow: 'hidden',
        }, innerStyle]}
      >
        {children}
      </View>
    </View>
  );
}

// ── GoldFill ────────────────────────────────────────────────────────────
// Absolute gradient fill. Parent needs overflow:'hidden' and a border radius.

export function GoldFill() {
  return (
    <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <LinearGradient id="goldfill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={theme.accentBright} />
          <Stop offset="55%" stopColor={theme.accent} />
          <Stop offset="100%" stopColor={theme.accentDeep} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#goldfill)" />
    </Svg>
  );
}

// ── AmbientGlow ─────────────────────────────────────────────────────────
// Soft radial glow, positioned by the caller; pointer events pass through.

export function AmbientGlow({
  size = 260, color = theme.accent, opacity = 0.16, style,
}: { size?: number; color?: string; opacity?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill="url(#bloom)" />
      </Svg>
    </View>
  );
}

// ── Button ──────────────────────────────────────────────────────────────
// Pill CTA with primary / ghost / danger variants.

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label, onPress, variant = 'primary', icon, disabled, small, style,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const ink = isPrimary ? theme.accentText : isDanger ? '#f6e8e8' : theme.textDim;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[{
        borderRadius: theme.pill,
        overflow: 'hidden',
        opacity: disabled ? 0.45 : 1,
        backgroundColor: isDanger ? theme.statusReally : isPrimary ? theme.accent : 'transparent',
        borderWidth: isPrimary || isDanger ? 0 : 1,
        borderColor: theme.hairline,
        boxShadow: isPrimary && !disabled ? `${theme.shadowGold}, ${theme.shadowInner}` : undefined,
      }, style]}
    >
      {isPrimary && !disabled ? <GoldFill /> : null}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        paddingVertical: small ? 10 : 14,
        paddingHorizontal: small ? 16 : 22,
        minHeight: small ? 38 : 48,
      }}>
        <Text style={{
          fontFamily: theme.fontUIBold,
          fontSize: small ? 12 : 13.5,
          letterSpacing: 0.4,
          color: ink,
        }}>{label}</Text>
        {icon ? (
          <View style={{
            width: small ? 20 : 24, height: small ? 20 : 24,
            borderRadius: theme.pill,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: isPrimary ? 'rgba(23,18,4,0.14)' : theme.glassStrong,
          }}>
            <Feather name={icon} size={small ? 11 : 13} color={ink} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

// ── IconDisc ────────────────────────────────────────────────────────────
// Circular icon button.

export function IconDisc({
  name, size = 38, iconSize, color = theme.textDim, active = false, onPress, style,
}: {
  name: keyof typeof Feather.glyphMap;
  size?: number;
  iconSize?: number;
  color?: string;
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      style={[{
        width: size, height: size, borderRadius: theme.pill,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? theme.accentSoft : theme.glass,
        borderWidth: 1,
        borderColor: active ? theme.borderStrong : theme.hairline,
      }, style]}
    >
      <Feather name={name} size={iconSize ?? Math.round(size * 0.42)} color={active ? theme.accent : color} />
    </PressableScale>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────
// Pulsing loading placeholder.

export function Skeleton({
  width, height, radius = theme.radiusSm, style,
}: { width?: ViewStyle['width']; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [pulse]);
  const aStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[{ width: width ?? '100%', height, borderRadius: radius, backgroundColor: theme.surface2 }, aStyle, style]}
    />
  );
}

// ── ProgressRing ────────────────────────────────────────────────────────
// Circular progress arc; children render in the centre.

export function ProgressRing({
  size = 56, stroke = 4, progress, color = theme.accent, children,
}: PropsWithChildren<{ size?: number; stroke?: number; progress: number; color?: string }>) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={theme.surface3} strokeWidth={stroke} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - clamped)}
        />
      </Svg>
      {children}
    </View>
  );
}

// ── ScreenHeader ────────────────────────────────────────────────────────
// Screen title with a back button and an optional right slot.

export function ScreenHeader({
  title, eyebrow, right, onBack, titleStyle,
}: {
  title: string;
  eyebrow?: string;
  right?: React.ReactNode;
  onBack?: (() => void) | false;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 8 }}>
      {onBack === false ? null : (
        <IconDisc name="chevron-left" onPress={onBack ?? (() => router.back())} />
      )}
      <View style={{ flex: 1 }}>
        {eyebrow ? (
          <Text style={{
            fontFamily: theme.fontMono, fontSize: 10, letterSpacing: 2,
            textTransform: 'uppercase', color: theme.textDim, marginBottom: 2,
          }}>{eyebrow}</Text>
        ) : null}
        <Text numberOfLines={1} style={[{
          fontFamily: theme.fontDisplaySemi, fontSize: 26, lineHeight: 32, color: theme.text,
        }, titleStyle]}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

// ── SectionHeader ───────────────────────────────────────────────────────
// In-page section title with an optional action.

export function SectionHeader({
  title, action, onAction,
}: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ fontFamily: theme.fontDisplaySemi, fontSize: 20, color: theme.text }}>{title}</Text>
      {action ? (
        <PressableScale onPress={onAction} haptic={false} style={{ paddingVertical: 4, paddingLeft: 12 }}>
          <Text style={{
            color: theme.accent, fontSize: 12, fontFamily: theme.fontUIBold, letterSpacing: 0.3,
          }}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
