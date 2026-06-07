// SheetCard — animated wrapper for modal panels. Adds a quick slide-up + fade
// so themed modals don't pop in flat. Use inside <Modal animationType="none">
// (the Modal itself shouldn't animate; this component owns the entrance).

import { useEffect, useRef } from 'react';
import { Animated, ViewStyle, StyleProp } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SheetCard({ children, style }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 180, useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0, duration: 220, useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
