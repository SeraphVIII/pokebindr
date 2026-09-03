// Animated wrapper for modal panels: spring slide-up plus fade.
// Use inside <Modal animationType="none">; this component owns the entrance.

import { useEffect } from 'react';
import { ViewStyle, StyleProp } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SheetCard({ children, style }: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(28);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 160 });
    translateY.value = withSpring(0, { damping: 24, stiffness: 300 });
  }, [opacity, translateY]);

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[aStyle, style]}>
      {children}
    </Animated.View>
  );
}
