import { Stack } from 'expo-router';

export default function SearchStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="recommendations" />
      <Stack.Screen name="feed" />
    </Stack>
  );
}