// New-binder form. Pick a name, grid size, and initial page count.

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useCreateBinder } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';

const SIZES: { label: string; cols: number; rows: number }[] = [
  { label: '1×1', cols: 1, rows: 1 },
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×3', cols: 4, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
];

export default function NewBinder() {
  const router = useRouter();
  const create = useCreateBinder();
  const toast = useToast();
  const [name, setName] = useState('');
  const [sizeIdx, setSizeIdx] = useState(2); // 3×3 default
  const [pages, setPages] = useState('1');

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Give your binder a name.');
      return;
    }
    const initialPages = Math.max(1, Math.min(50, parseInt(pages, 10) || 1));
    const size = SIZES[sizeIdx];
    try {
      const binder = await create.mutateAsync({
        name: trimmedName,
        cols: size.cols,
        rows: size.rows,
        initialPages,
      });
      router.replace(`/binder/${binder.id}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Could not create binder');
    }
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={theme.textDim} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
          <Eyebrow>New binder</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 40,
          }}>Set it up</Text>

          {/* name */}
          <View style={{ marginTop: 22 }}>
            <Eyebrow style={{ marginBottom: 6 }}>Name</Eyebrow>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Holos · 2024"
              placeholderTextColor={theme.textMute}
              autoFocus
              style={{
                backgroundColor: theme.surface,
                borderWidth: 1, borderColor: theme.border,
                borderRadius: theme.radius,
                padding: 14, fontSize: 15,
                color: theme.text, fontFamily: theme.fontUI,
              }}
            />
          </View>

          {/* size */}
          <View style={{ marginTop: 22 }}>
            <Eyebrow style={{ marginBottom: 6 }}>Grid size</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SIZES.map((s, i) => {
                const active = i === sizeIdx;
                return (
                  <Pressable
                    key={s.label}
                    onPress={() => setSizeIdx(i)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10,
                      borderRadius: theme.radius,
                      borderWidth: 1,
                      borderColor: active ? theme.accent : theme.border,
                      backgroundColor: active ? theme.accent : 'transparent',
                    }}>
                    <Text style={{
                      fontFamily: theme.fontMono, fontSize: 13,
                      color: active ? theme.accentText : theme.textDim,
                      letterSpacing: 0.5,
                    }}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{
              color: theme.textDim, fontSize: 12, marginTop: 8,
              fontFamily: theme.fontMono,
            }}>
              {SIZES[sizeIdx].cols * SIZES[sizeIdx].rows} cards per page
            </Text>
          </View>

          {/* pages */}
          <View style={{ marginTop: 22 }}>
            <Eyebrow style={{ marginBottom: 6 }}>Initial pages</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Stepper
                value={pages}
                onChange={setPages}
                min={1}
                max={50}
              />
              <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono, flex: 1 }}>
                Pages auto-grow as you add cards.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={submit}
            disabled={create.isPending}
            style={{
              marginTop: 32,
              backgroundColor: theme.accent,
              padding: 16, borderRadius: theme.radius,
              opacity: create.isPending ? 0.6 : 1,
            }}>
            <Text style={{
              color: theme.accentText, textAlign: 'center',
              fontFamily: theme.fontUIBold, fontSize: 14,
              letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Create binder</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Stepper({ value, onChange, min, max }: {
  value: string; onChange: (v: string) => void; min: number; max: number;
}) {
  const n = parseInt(value, 10) || min;
  const dec = () => onChange(String(Math.max(min, n - 1)));
  const inc = () => onChange(String(Math.min(max, n + 1)));
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border,
      borderRadius: theme.radius,
    }}>
      <Pressable onPress={dec} hitSlop={6} style={{ padding: 12 }}>
        <Feather name="minus" size={14} color={theme.text} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        style={{
          minWidth: 36, textAlign: 'center',
          color: theme.text, fontFamily: theme.fontMono, fontSize: 15,
          paddingVertical: 8,
        }}
      />
      <Pressable onPress={inc} hitSlop={6} style={{ padding: 12 }}>
        <Feather name="plus" size={14} color={theme.text} />
      </Pressable>
    </View>
  );
}
