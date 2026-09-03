import { Stack } from 'expo-router';
import { theme } from '@/lib/theme';

export default function CardLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    />
  );
}
