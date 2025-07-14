import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { DialogProvider } from '@/contexts/DialogProvider';
import { AuthProvider } from '@/contexts/AuthProvider';
import { SnackbarProvider } from '@/contexts/SnackbarProvider';
import { PaperProvider } from 'react-native-paper';

export default function RootLayout() {
  useFrameworkReady();

  return (
    <PaperProvider>
      <SnackbarProvider>
        <DialogProvider>
          <AuthProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <StatusBar style="light" />
            </GestureHandlerRootView>
          </AuthProvider>
        </DialogProvider>
      </SnackbarProvider>
    </PaperProvider>
  );
}
