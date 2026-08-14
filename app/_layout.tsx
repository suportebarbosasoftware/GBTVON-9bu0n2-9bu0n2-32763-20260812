import { AlertProvider } from '@/template';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/contexts/AuthContext';
import { DevModeProvider } from '@/contexts/DevModeContext';

// Orientation is locked to landscape via app.json "orientation": "landscape"
// expo-screen-orientation is NOT used — crashes on Android TV

export default function RootLayout() {
  return (
    <AlertProvider>
      <SafeAreaProvider>
        <DevModeProvider>
        <AuthProvider>
          <StatusBar style="light" hidden />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#000000' },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="channel-setup" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="player"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'fade',
              }}
            />
            <Stack.Screen
              name="series-detail"
              options={{
                headerShown: false,
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="admin"
              options={{
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="rep-panel"
              options={{
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="blocked"
              options={{
                headerShown: false,
                animation: 'fade',
              }}
            />
          </Stack>
        </AuthProvider>
        </DevModeProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
