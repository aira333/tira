import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { brand, clearAllData, store } from '../engine';
import { cancelAllReminders } from '../tira/device';
import { useTira } from '../tira/TiraProvider';
import { colors, space, type } from '../tira/theme';
import { speak } from '../tira/voice';

const USER_ID = 'device-user';

const RATES = [
  { label: 'Slower', value: 0.8 },
  { label: 'Normal', value: 1.0 },
  { label: 'Faster', value: 1.2 },
];

function Row({ label, detail, children }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Button({ label, onPress, danger, hint }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, danger && styles.buttonDanger, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityHint={hint}
    >
      <Text style={[styles.buttonText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, voiceAvailable, clearConversation, refreshData } = useTira();
  const [profile, setProfile] = useState(null);

  useFocusEffect(
    useCallback(() => {
      store.getUserProfile(USER_ID).then(setProfile).catch(() => setProfile(null));
    }, []),
  );

  const eraseAll = async () => {
    await cancelAllReminders();
    await clearAllData();
    clearConversation();
    setProfile(null);
    refreshData();
  };

  const confirmErase = () => {
    const message =
      'This deletes all appointments, lists, reminders, your name, and ride contacts from this phone. This cannot be undone.';
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(message)) eraseAll();
      return;
    }
    Alert.alert('Erase all Tira data?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: eraseAll },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading} accessibilityRole="header">
        Voice
      </Text>
      <View style={styles.card}>
        <Row
          label={`Hands-free "${brand.displayName}"`}
          detail={
            voiceAvailable
              ? `Keep listening while the app is open. Start any request with "${brand.displayName}".`
              : 'Needs a development build with speech recognition.'
          }
        >
          <Switch
            value={settings.handsFree}
            onValueChange={(v) => updateSettings({ handsFree: v })}
            disabled={!voiceAvailable}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.text}
            accessibilityLabel="Hands-free wake word"
          />
        </Row>
        <Row label="Speak replies" detail="Tira reads every answer out loud.">
          <Switch
            value={settings.speakReplies}
            onValueChange={(v) => updateSettings({ speakReplies: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.text}
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
      </View>

      <Text style={styles.heading} accessibilityRole="header">
        About you
      </Text>
      <View style={styles.card}>
        <Row label="Name" detail={profile?.userName || 'Not set. Say "my name is…"'} />
        <Row
          label="Ride service"
          detail={
            profile?.transportName
              ? `${profile.transportName}${profile.transportPhone ? `, ${profile.transportPhone}` : ''}`
              : 'Not set. Say "my transport is…, number…"'
          }
        />
        <Row
          label="Appointment lists"
          detail={profile?.listVerbosity === 'brief' ? 'Brief' : 'Detailed. Say "use brief lists" to change.'}
        />
      </View>

      <Text style={styles.heading} accessibilityRole="header">
        Data
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowDetail}>Everything Tira saves stays on this phone. Nothing is sent to a server.</Text>
        <Button label="Clear conversation" onPress={clearConversation} hint="Clears the chat on the Talk screen" />
        <Button label="Erase all data" onPress={confirmErase} danger hint="Asks for confirmation first" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5), paddingBottom: space(6) },
  heading: { color: colors.text, fontSize: type.heading, fontWeight: '700', marginTop: space(1) },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(2),
    gap: space(2),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  rowLabel: { color: colors.text, fontSize: type.body, fontWeight: '600' },
  rowDetail: { color: colors.textMuted, fontSize: type.small, lineHeight: 24, marginTop: 2 },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.text, fontSize: type.small, fontWeight: '700' },
  button: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.danger },
  buttonText: { color: colors.text, fontSize: type.body, fontWeight: '700' },
});
