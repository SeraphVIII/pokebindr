import { Tabs } from 'expo-router';
import { theme } from '@/lib/theme';
import { VaultTabBar } from '@/components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <VaultTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="binder" options={{ title: 'Binder' }} />
      <Tabs.Screen name="sets" options={{ title: 'Sets' }} />
      <Tabs.Screen name="lookup" options={{ title: 'Search' }} />
      <Tabs.Screen name="wantlist" options={{ title: 'Hunt' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
