// Floating dock-style bottom tab bar.

import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/ui';
import { theme } from '@/lib/theme';

// Structural subset of @react-navigation/bottom-tabs' BottomTabBarProps.
// The package is not a direct dependency, so only the fields read here are typed.
interface TabRoute { key: string; name: string; params?: object }
interface TabBarProps {
  state: { index: number; routes: TabRoute[] };
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
}

const TAB_META: Record<string, { icon: keyof typeof Feather.glyphMap; label: string }> = {
  index:    { icon: 'home',      label: 'Home' },
  binder:   { icon: 'grid',      label: 'Binder' },
  sets:     { icon: 'book-open', label: 'Sets' },
  lookup:   { icon: 'search',    label: 'Search' },
  wantlist: { icon: 'star',      label: 'Hunt' },
  profile:  { icon: 'user',      label: 'You' },
};

export function VaultTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{
      backgroundColor: theme.bg,
      paddingBottom: Math.max(insets.bottom, 10),
      paddingTop: 6,
      paddingHorizontal: 14,
    }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(26,21,17,0.98)',
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: theme.pill,
        paddingHorizontal: 6,
        paddingVertical: 6,
        boxShadow: `${theme.shadowAmbient}, ${theme.shadowInner}`,
      }}>
        {state.routes.map((route, index) => {
          const meta = TAB_META[route.name] ?? { icon: 'circle' as const, label: route.name };
          const focused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress', target: route.key, canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <PressableScale
              key={route.key}
              onPress={onPress}
              scaleTo={0.92}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                paddingVertical: 8,
                borderRadius: theme.pill,
                backgroundColor: focused ? theme.accentSoft : 'transparent',
              }}
            >
              <Feather
                name={meta.icon}
                size={19}
                color={focused ? theme.accent : theme.textDim}
              />
              <Text style={{
                fontFamily: theme.fontUIBold,
                fontSize: 8.5,
                letterSpacing: 0.7,
                textTransform: 'uppercase',
                color: focused ? theme.accent : theme.textMute,
              }}>
                {meta.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
