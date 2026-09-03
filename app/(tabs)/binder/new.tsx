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
import { Button, IconDisc } from '@/components/ui';
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
          <IconDisc name="chevron-left" onPress={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
          <Eyebrow>New binder</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplaySemi,
            fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 38,
          }}>Set it up</Text>

          <View style={{ marginTop: 24 }}>
            <Eyebrow style={{ marginBottom: 8 }}>Name</Eyebrow>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Holos · 2024"
              placeholderTextColor={theme.textMute}
              autoFocus
              style={{
                backgroundColor: theme.glass,
                borderWidth: 1, borderColor: theme.hairline,
                borderRadius: theme.radius,
                paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
                color: theme.text, fontFamily: theme.fontUI,
                boxShadow: theme.shadowInner,
              }}
            />
          </View>

          <View style={{ marginTop: 24 }}>
            <Eyebrow style={{ marginBottom: 8 }}>Grid size</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SIZES.map((s, i) => {
                const active = i === sizeIdx;
                return (
                  <Pressable
                    key={s.label}
                    onPress={() => setSizeIdx(i)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 16, paddingVertical: 11,
                      borderRadius: theme.radius,
                      borderWidth: 1,
                      borderColor: active ? theme.accent : theme.hairline,
                      backgroundColor: active ? theme.accentSoft : theme.glass,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                    })}>
                    <Text style={{
                      fontFamily: theme.fontMono, fontSize: 13,
                      color: active ? theme.accent : theme.textDim,
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

          <Button
            label="Create binder"
            icon="arrow-right"
            onPress={submit}
            disabled={create.isPending}
            style={{ marginTop: 32 }}
          />
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
      backgroundColor: theme.glass,
      borderWidth: 1, borderColor: theme.hairline,
      borderRadius: theme.pill,
      boxShadow: theme.shadowInner,
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
