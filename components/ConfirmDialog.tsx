// Themed confirmation dialog. Mount <ConfirmProvider> once at the root;
// useConfirm() returns an imperative confirm(opts) => Promise<boolean>.

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { theme } from '@/lib/theme';
import { Eyebrow } from './Eyebrow';
import { SheetCard } from './SheetCard';
import { Button } from './ui';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  // Tints the confirm button red.
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
  // Resolver kept in a ref so close() can settle the promise on any dismissal
  // path, including the OS back button.
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
          flex: 1, backgroundColor: theme.scrim,
          justifyContent: 'center', alignItems: 'center', padding: 24,
        }}>
          <SheetCard
            key={pending ? 'open' : 'closed'}
            style={{
              width: '100%', maxWidth: theme.maxContentW - 48,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.hairline,
              borderRadius: theme.radiusXl,
              padding: 24,
              boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
            }}
          >
            <Eyebrow>Confirm</Eyebrow>
            <Text style={{
              fontFamily: theme.fontDisplaySemi, fontSize: 23,
              color: theme.text, marginTop: 8, lineHeight: 30,
            }}>
              {pending?.title}
            </Text>
            {pending?.message ? (
              <Text style={{
                color: theme.textDim, fontSize: 13.5, fontFamily: theme.fontUI,
                marginTop: 10, lineHeight: 20,
              }}>
                {pending.message}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
              <Button
                label={pending?.cancelText ?? 'Cancel'}
                variant="ghost"
                onPress={() => close(false)}
                style={{ flex: 1 }}
              />
              <Button
                label={pending?.confirmText ?? 'Confirm'}
                variant={pending?.destructive ? 'danger' : 'primary'}
                onPress={() => close(true)}
                style={{ flex: 1 }}
              />
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
