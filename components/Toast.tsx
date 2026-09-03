// App-wide toast/snackbar for non-blocking feedback. Mount <ToastProvider>
// once at the root; call useToast() from any screen.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { theme } from '@/lib/theme';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++_id;
    setToasts((t) => [...t, { id, kind, message }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const value: ToastContextValue = {
    show,
    info: (m) => show(m, 'info'),
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastStack({
  toasts, onDismiss,
}: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        // Offset clears the floating tab dock.
        position: 'absolute', left: 0, right: 0,
        bottom: insets.bottom + 84,
        alignItems: 'center',
      }}
    >
      {toasts.map((t) => (
        <ToastBubble key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </View>
  );
}

const KIND_COLOR: Record<ToastKind, string> = {
  info: theme.accent,
  success: theme.statusHave,
  error: theme.statusReally,
};

const KIND_ICON: Record<ToastKind, 'info' | 'check-circle' | 'alert-triangle'> = {
  info: 'info',
  success: 'check-circle',
  error: 'alert-triangle',
};

function ToastBubble({
  toast, onDismiss,
}: { toast: ToastItem; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 220, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, 2400);
    return () => clearTimeout(t);
  }, [opacity, translateY, onDismiss]);

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }],
        marginTop: 8,
        maxWidth: '92%',
      }}
    >
      <Pressable
        onPress={onDismiss}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingVertical: 10, paddingHorizontal: 12, paddingRight: 18,
          backgroundColor: 'rgba(26,21,17,0.98)',
          borderWidth: 1, borderColor: theme.hairline,
          borderRadius: theme.pill,
          boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
        }}
      >
        <View style={{
          width: 30, height: 30, borderRadius: theme.pill,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: KIND_COLOR[toast.kind] + '22',
        }}>
          <Feather name={KIND_ICON[toast.kind]} size={15} color={KIND_COLOR[toast.kind]} />
        </View>
        <Text
          numberOfLines={3}
          style={{
            flexShrink: 1,
            color: theme.text,
            fontSize: 13, fontFamily: theme.fontUI,
          }}
        >
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
