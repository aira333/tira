import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { brand, clearAllData, store } from '../../engine';
import { useAuth } from '../../tira/AuthProvider';
import { confirm } from '../../tira/confirm';
import { cancelAllReminders } from '../../tira/device';
import { useTira } from '../../tira/TiraProvider';
import { colors, fonts, radius, shadow, space, type } from '../../tira/theme';
import { speak } from '../../tira/voice';

const USER_ID = 'device-user';

const RATES = [
  { label: 'Slower', value: 0.8 },
  { label: 'Normal', value: 1.0 },
  { label: 'Faster', value: 1.2 },
];

const SYNC_LABEL = {
  synced: { text: 'Synced to your account', icon: 'cloud-done-outline', color: colors.listening },
  syncing: { text: 'Syncing…', icon: 'sync-outline', color: '#B7791F' },
  offline: { text: 'Offline. Changes will sync when you reconnect.', icon: 'cloud-offline-outline', color: colors.thinking },
};

function Row({ label, detail, icon, children }) {
  return (
    <View style={styles.row}>
      {icon ? (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={20} color={colors.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Button({ label, icon, onPress, variant = 'plain', hint, disabled }) {
  const v = styles[`btn_${variant}`];
  const t = styles[`btnText_${variant}`];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, v, (pressed || disabled) && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityHint={hint}
    >
      {icon ? <Ionicons name={icon} size={20} color={t.color} /> : null}
      <Text style={[styles.buttonText, t]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }) {
  return (
    <View style={{ gap: space(1.25) }}>
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function AccountSection() {
  const auth = useAuth();
  const { profile, status, syncState, busy } = auth;

  if (status !== 'signedIn') {
    return (
      <Section title="Account">
        <Row
          icon="person-circle-outline"
          label="Not signed in"
          detail={
            auth.cloudEnabled
              ? `Sign in with Google so ${brand.displayName} remembers you on any phone.`
              : 'Google sign-in is not set up in this build.'
          }
        />
        {auth.cloudEnabled ? (
          <Button label="Sign in with Google" icon="logo-google" variant="primary" onPress={auth.goToSignIn} />
        ) : null}
      </Section>
    );
  }

  const sync = SYNC_LABEL[syncState] || SYNC_LABEL.synced;

  const onSignOut = async () => {
    const ok = await confirm(
      'Sign out?',
      `Your data stays in your ${brand.displayName} account. Sign in again to get it back on this phone.`,
      'Sign out',
    );
    if (ok) auth.signOut();
  };

  const onDelete = async () => {
    const ok = await confirm(
      'Delete your account?',
      `This permanently deletes your ${brand.displayName} account and everything in it: appointments, lists, reminders, your name and ride contacts. This cannot be undone.`,
      'Delete account',
    );
    if (ok) await auth.deleteAccount();
  };

  return (
    <Section title="Account">
      <View style={styles.accountRow}>
        {profile?.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.accountAvatar} />
        ) : (
          <View style={[styles.accountAvatar, styles.accountFallback]}>
            <Text style={styles.accountInitial}>{(profile?.givenName || '?')[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.accountName}>{profile?.fullName || profile?.givenName}</Text>
          <Text style={styles.rowDetail}>{profile?.email}</Text>
        </View>
      </View>
      <View style={styles.syncRow} accessibilityLiveRegion="polite">
        <Ionicons name={sync.icon} size={18} color={sync.color} />
        <Text style={[styles.syncText, { color: sync.color }]}>{sync.text}</Text>
      </View>
      <Button label="Sign out" icon="log-out-outline" onPress={onSignOut} disabled={busy} />
      <Button label="Delete account" icon="trash-outline" variant="danger" onPress={onDelete} disabled={busy} hint="Asks for confirmation first" />
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
      {auth.error ? <Text style={styles.error}>{auth.error}</Text> : null}
    </Section>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, voiceAvailable, clearConversation, refreshData, dataVersion } = useTira();
  const { status } = useAuth();
  const [profile, setProfile] = useState(null);

  useFocusEffect(
    useCallback(() => {
      store.getUserProfile(USER_ID).then(setProfile).catch(() => setProfile(null));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataVersion]),
  );

  const eraseAll = async () => {
    await cancelAllReminders();
    await clearAllData();
    clearConversation();
    setProfile(null);
    refreshData();
  };

  const confirmErase = async () => {
    const ok = await confirm(
      `Erase all ${brand.displayName} data?`,
      status === 'signedIn'
        ? 'This deletes all appointments, lists, reminders, your name and ride contacts from this phone and from your account. Your sign-in stays. This cannot be undone.'
        : 'This deletes all appointments, lists, reminders, your name and ride contacts from this phone. This cannot be undone.',
      'Erase',
    );
    if (ok) eraseAll();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <AccountSection />

      <Section title="Voice">
        <Row
          icon="ear-outline"
          label={`Hands-free "${brand.displayName}"`}
          detail={
            voiceAvailable
              ? `Keep listening while the app is open. Start any request with "${brand.displayName}".`
              : 'Needs the installed app build with speech recognition.'
          }
        >
          <Switch
            value={settings.handsFree}
            onValueChange={(v) => updateSettings({ handsFree: v })}
            disabled={!voiceAvailable}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#FFFFFF"
            activeThumbColor="#FFFFFF"
            accessibilityLabel="Hands-free wake word"
          />
        </Row>
        <Row icon="volume-high-outline" label="Speak replies" detail={`${brand.displayName} reads every answer out loud.`}>
          <Switch
            value={settings.speakReplies}
            onValueChange={(v) => updateSettings({ speakReplies: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#FFFFFF"
            activeThumbColor="#FFFFFF"
            accessibilityLabel="Speak replies"
          />
        </Row>
        <Text style={styles.rowLabel}>Speaking speed</Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {RATES.map((r) => {
            const selected = settings.speechRate === r.value;
            return (
              <Pressable
                key={r.label}
                onPress={() => {
                  updateSettings({ speechRate: r.value });
                  speak(`This is how ${brand.displayName} sounds.`, { rate: r.value });
                }}
                style={[styles.segmentItem, selected && styles.segmentOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segmentText, selected && { color: colors.accentText }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button
          label="Test voice"
          icon="play-circle-outline"
          onPress={() =>
            speak(
              `Hi${profile?.userName ? ` ${profile.userName}` : ''}, I'm ${brand.displayName}. Say ${brand.displayName}, what's my day, to hear your daily briefing.`,
              { rate: settings.speechRate },
            )
          }
          hint="Plays a sample of Tira's voice"
        />
      </Section>

      <Section title="About you">
        <Row icon="person-outline" label="Name" detail={profile?.userName || 'Not set. Say "my name is…"'} />
        <Row
          icon="car-outline"
          label="Ride service"
          detail={
            profile?.transportName
              ? `${profile.transportName}${profile.transportPhone ? `, ${profile.transportPhone}` : ''}`
              : 'Not set. Say "my transport is…, number…"'
          }
        />
        <Row
          icon="list-outline"
          label="Appointment lists"
          detail={profile?.listVerbosity === 'brief' ? 'Brief' : 'Detailed. Say "use brief lists" to change.'}
        />
      </Section>

      <Section title="Data">
        <Text style={styles.rowDetail}>
          {status === 'signedIn'
            ? `Saved on this phone and in your private ${brand.displayName} account.`
            : 'Everything is saved only on this phone.'}
        </Text>
        <Button label="Clear conversation" icon="chatbubbles-outline" onPress={clearConversation} hint="Clears the chat on the Talk screen" />
        <Button label="Erase all data" icon="trash-outline" variant="danger" onPress={confirmErase} hint="Asks for confirmation first" />
      </Section>

      <Section title="About">
        <Row icon="information-circle-outline" label={brand.displayName} detail={`Version ${Constants.expoConfig?.version || '1.0.0'} · ${brand.summary}`} />
        <Text style={styles.rowDetail}>
          Try saying: "{brand.displayName}, what's my day", "what's next", "repeat that", or "help".
        </Text>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(2.5), gap: space(3), paddingBottom: space(6) },
  heading: { color: colors.text, fontFamily: fonts.display, fontSize: type.heading },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(2),
    gap: space(2),
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: type.body - 1 },
  rowDetail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small - 1, lineHeight: 23, marginTop: 2 },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  accountAvatar: { width: 56, height: 56, borderRadius: 28 },
  accountFallback: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  accountInitial: { color: colors.accentText, fontFamily: fonts.display, fontSize: 24 },
  accountName: { color: colors.text, fontFamily: fonts.display, fontSize: type.body },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    backgroundColor: colors.bg,
    borderRadius: radius.control,
    paddingVertical: space(1),
    paddingHorizontal: space(1.5),
  },
  syncText: { fontFamily: fonts.bodyBold, fontSize: type.tiny, flexShrink: 1 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: type.small },

  segment: {
    flexDirection: 'row',
    borderRadius: radius.control,
    backgroundColor: colors.bg,
    padding: 4,
    gap: 4,
  },
  segmentItem: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: type.small },

  button: {
    minHeight: 52,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
  },
  btn_plain: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btn_primary: { backgroundColor: colors.accent },
  btn_danger: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.danger },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.body - 1 },
  btnText_plain: { color: colors.text },
  btnText_primary: { color: colors.accentText },
  btnText_danger: { color: colors.danger },
});
