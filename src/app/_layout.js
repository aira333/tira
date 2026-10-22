import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../tira/AuthProvider';
import { TiraProvider } from '../tira/TiraProvider';
import { colors } from '../tira/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Signed-out users see the sign-in screen; everyone else sees the app. */
function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const onSignIn = segments[0] === 'sign-in';
  // The Google redirect page finishes sign-in itself; don't bounce it away.
  const onAuthCallback = segments[0] === 'auth';

  useEffect(() => {
    if (status === 'loading') return;
    SplashScreen.hideAsync().catch(() => {});
    if (onAuthCallback) return;
    if (status === 'signedOut' && !onSignIn) router.replace('/sign-in');
    if ((status === 'guest' || status === 'signedIn') && onSignIn) router.replace('/');
  }, [status, onSignIn, onAuthCallback, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      <Stack.Screen name="auth/callback" options={{ animation: 'fade' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  });

  // Fall back to system fonts rather than hang if a font fails to load.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <TiraProvider>
          <StatusBar style="dark" />
          <AuthGate />
        </TiraProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
