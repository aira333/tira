import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import brand from '../engine/brand';
import { useAuth } from '../tira/AuthProvider';
import Wordmark from '../tira/components/Wordmark';
import { colors, fonts, gradients, radius, shadow, space, type } from '../tira/theme';

const POINTS = [
  { icon: 'mic-outline', text: 'Talk naturally: "Tira, what\'s my day?"' },
  { icon: 'calendar-outline', text: 'Appointments, reminders, lists and rides' },
  { icon: 'cloud-done-outline', text: 'Sign in to keep everything on any phone' },
];

export default function SignInScreen() {
  const { signIn, continueAsGuest, busy, error, cloudEnabled } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(3) }]}
    >
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Wordmark size={54} color="#FFFFFF" dotColor="#7FD1A8" />
        <Text style={styles.heroLine}>Your voice assistant for the day ahead.</Text>
        <View style={styles.points}>
          {POINTS.map((p) => (
            <View key={p.text} style={styles.point}>
              <View style={styles.pointIcon}>
                <Ionicons name={p.icon} size={20} color="#FFFFFF" />
              </View>
              <Text style={styles.pointText}>{p.text}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <View style={styles.actions}>
        <Text style={styles.heading} accessibilityRole="header">
          Welcome to {brand.displayName}
        </Text>
        <Text style={styles.sub}>
          Sign in so {brand.displayName} remembers your name, appointments and lists, even if you change phones.
        </Text>

        <Pressable
          onPress={signIn}
          disabled={busy || !cloudEnabled}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          style={({ pressed }) => [styles.google, (pressed || busy) && { opacity: 0.85 }, !cloudEnabled && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Ionicons name="logo-google" size={22} color={colors.text} />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={continueAsGuest}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.guest, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.guestText}>Continue without an account</Text>
        </Pressable>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {!cloudEnabled ? (
          <Text style={styles.note}>
            Google sign-in isn't set up in this build yet. You can still use everything on this phone.
          </Text>
        ) : null}

        <Text style={styles.fine}>
          Without an account, your data stays only on this phone. With Google, it's stored securely in your private
          {` ${brand.displayName}`} account. You can delete it anytime in Settings.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space(2), gap: space(3), flexGrow: 1 },
  hero: { borderRadius: 28, padding: space(3), gap: space(2), paddingTop: space(4) },
  heroLine: { color: '#E6F2EB', fontFamily: fonts.displaySemi, fontSize: type.heading + 2, lineHeight: 32 },
  points: { gap: space(1.5), marginTop: space(1) },
  point: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { color: '#FFFFFF', fontFamily: fonts.body, fontSize: type.small, flex: 1, lineHeight: 24 },

  actions: { gap: space(1.5) },
  heading: { color: colors.text, fontFamily: fonts.display, fontSize: type.title },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small, lineHeight: 25, marginBottom: space(1) },
  google: {
    minHeight: 60,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1.5),
    ...shadow.card,
  },
  googleText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: type.body },
  guest: { minHeight: 56, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  guestText: { color: colors.accent, fontFamily: fonts.bodyBold, fontSize: type.small, textDecorationLine: 'underline' },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: type.small, textAlign: 'center' },
  note: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: type.tiny,
    textAlign: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.control,
    padding: space(1.5),
  },
  fine: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.tiny, lineHeight: 21, textAlign: 'center' },
});
