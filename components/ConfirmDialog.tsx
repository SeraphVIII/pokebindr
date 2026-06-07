// Themed confirmation dialog. Replaces native Alert.alert(... [Cancel, Confirm])
// so destructive actions match the rest of the app instead of a system-white
// popup. Mount <ConfirmProvider> once at the root, then call useConfirm() from
// any screen — it returns an imperative confirm(opts) => Promise<boolean>.

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { theme } from '@/lib/theme';
import { Eyebrow } from './Eyebrow';
import { SheetCard } from './SheetCard';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  // Tints the confirm button red when true. Use for delete / sign-out / any
  // action the user can't trivially undo.
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Stash the resolver so close handlers can settle the promise even when the
  // user dismisses via the OS back button instead of tapping a button.
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = (ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(ok);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        visible={!!pending}
        transparent
        animationType="none"
        onRequestClose={() => close(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center', alignItems: 'center', padding: 24,
        }}>
          <SheetCard
            key={pending ? 'open' : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.borderStrong,
              borderRadius: theme.radius * 1.5,
              padding: 20,
            }}
          >
            <Eyebrow>Confirm</Eyebrow>
            <Text style={{
              fontFamily: theme.fontDisplay, fontSize: 20,
              color: theme.text, marginTop: 8, lineHeight: 28,
            }}>
              {pending?.title}
            </Text>
            {pending?.message ? (
              <Text style={{
                color: theme.textDim, fontSize: 13,
                marginTop: 10, lineHeight: 19,
              }}>
                {pending.message}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
              <Pressable
                onPress={() => close(false)}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  borderWidth: 1, borderColor: theme.border,
                  alignItems: 'center',
                }}>
                <Text style={{
                  color: theme.textDim, fontFamily: theme.fontUIBold,
                  fontSize: 12, textTransform: 'uppercase',
                }}>
                  {pending?.cancelText ?? 'Cancel'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => close(true)}
                style={{
                  flex: 1, padding: 12, borderRadius: theme.radius,
                  backgroundColor: pending?.destructive ? theme.statusReally : theme.accent,
                  alignItems: 'center',
                }}>
                <Text style={{
                  color: pending?.destructive ? '#fff' : theme.accentText,
                  fontFamily: theme.fontUIBold,
                  fontSize: 12, textTransform: 'uppercase',
                }}>
                  {pending?.confirmText ?? 'Confirm'}
                </Text>
              </Pressable>
            </View>
          </SheetCard>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx.confirm;
}
