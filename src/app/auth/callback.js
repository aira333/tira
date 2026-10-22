// Landing page for the Google sign-in redirect (…/auth/callback?code=…).
// On web the browser arrives here; on Android the tira://auth/callback link
// can open it too. Finish the sign-in, then go home.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../tira/AuthProvider';
import { supabase } from '../../tira/supabase';
import { colors, fonts, radius, space, type } from '../../tira/theme';

export default function AuthCallback() {
  const { status } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [error, setError] = useState(null);
  const triedExchange = useRef(false);

  const code = typeof params.code === 'string' ? params.code : null;
  const errorDescription = typeof params.error_description === 'string' ? params.error_description : null;

  // Signed in (by the Supabase client or by the exchange below): go home.
  useEffect(() => {
    if (status === 'signedIn' || status === 'guest') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (errorDescription) {
      setError(errorDescription);
      return undefined;
    }
    // Usually the Supabase client has already finished this by itself. If it
    // hasn't after a moment, exchange the code ourselves.
    const t = setTimeout(async () => {
      if (!supabase || !code || triedExchange.current) return;
      triedExchange.current = true;
      const { data } = await supabase.auth.getSession();
      if (data?.session) return; // onAuthStateChange takes it from here
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) setError(exErr.message);
    }, 1500);
    const giveUp = setTimeout(() => {
      setError((e) => e || 'Sign-in is taking too long. Please try again.');
    }, 15000);
    return () => {
      clearTimeout(t);
      clearTimeout(giveUp);
    };
  }, [code, errorDescription]);

  return (
    <View style={styles.page}>
      {error ? (
        <>
          <Text style={styles.title}>Couldn't finish signing in</Text>
          <Text style={styles.body}>{error}</Text>
          <Pressable
            onPress={() => router.replace('/sign-in')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.buttonText}>Back to sign-in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.body} accessibilityLiveRegion="polite">
            Signing you in…
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    padding: space(3),
  },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: type.heading, textAlign: 'center' },
  body: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small, textAlign: 'center', lineHeight: 24 },
  button: {
    minHeight: 52,
    paddingHorizontal: space(3),
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.accentText, fontFamily: fonts.bodyBold, fontSize: type.body },
});
