import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import brand from '../../engine/brand';
import { useAuth } from '../../tira/AuthProvider';
import MicOrb from '../../tira/components/MicOrb';
import Wordmark from '../../tira/components/Wordmark';
import { useTira } from '../../tira/TiraProvider';
import { colors, fonts, radius, shadow, space, type } from '../../tira/theme';

const STATUS_LABEL = {
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking · tap to stop',
};

const QUICK_ACTIONS = [
  { label: "What's my day?", text: "What's my day?", icon: 'sunny-outline' },
  { label: "What's next?", text: "What's next?", icon: 'arrow-forward-circle-outline' },
  { label: 'Add appointment', text: 'Add an appointment', icon: 'add-circle-outline' },
  { label: 'Shopping list', text: "What's on my shopping list?", icon: 'cart-outline' },
  { label: 'To-dos', text: "What's on my to do list?", icon: 'checkbox-outline' },
  { label: 'Request a ride', text: 'Request a ride to my appointment', icon: 'car-outline' },
  { label: 'Help', text: 'Help', icon: 'help-circle-outline' },
];

function partOfDay(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function titleCase(s) {
  return String(s || '').replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function doctorLabel(name) {
  const n = titleCase(name);
  return /^(dr\.?|doctor)\b/i.test(n) ? n : `Dr. ${n}`;
}

function whenLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

function Avatar({ size = 44 }) {
  const { profile, syncState, status } = useAuth();
  const { briefing } = useTira();
  const router = useRouter();
  const initial = (briefing?.userName || profile?.givenName || brand.displayName)[0]?.toUpperCase();
  const dot =
    status !== 'signedIn' ? null : syncState === 'offline' ? colors.thinking : syncState === 'syncing' ? '#D9A441' : colors.listening;
  return (
    <Pressable
      onPress={() => router.navigate('/settings')}
      accessibilityRole="button"
      accessibilityLabel={
        status === 'signedIn' ? `Account: ${profile?.fullName || profile?.email}. Opens settings.` : 'Settings'
      }
      hitSlop={8}
    >
      {profile?.avatarUrl ? (
        <Image source={{ uri: profile.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      )}
      {dot ? <View style={[styles.syncDot, { backgroundColor: dot }]} /> : null}
    </Pressable>
  );
}

function Header() {
  const { briefing } = useTira();
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const name = briefing?.userName || profile?.givenName;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <View style={{ paddingTop: insets.top + space(1), gap: space(2.5) }}>
      <View style={styles.topBar}>
        <Wordmark size={30} />
        <Avatar />
      </View>
      <View>
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.greeting} accessibilityRole="header">
          {partOfDay()}
          {name ? ',' : ''}
        </Text>
        {name ? <Text style={styles.name}>{name}</Text> : null}
      </View>
    </View>
  );
}

function DayCard() {
  const { briefing } = useTira();
  const router = useRouter();
  if (!briefing) return null;
  const next = briefing.nextAppointment;
  const { todos, shopping } = briefing.counts || {};

  const label = [
    next ? `Next appointment: ${doctorLabel(next.doctorName)}, ${whenLabel(next.dateTime)}` : 'No upcoming appointments',
    `${briefing.todayAppointments?.length || 0} today`,
    `${todos || 0} to-dos`,
    `${shopping || 0} items to buy`,
  ].join('. ');

  return (
    <Pressable
      onPress={() => router.navigate('/today')}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens My Day"
      style={({ pressed }) => [styles.dayCard, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Ionicons name="calendar" size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardKicker}>UP NEXT</Text>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {next ? doctorLabel(next.doctorName) : 'Nothing scheduled'}
          </Text>
          {next ? <Text style={styles.cardWhen}>{whenLabel(next.dateTime)}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
      </View>
      <View style={styles.statsRow}>
        <Stat value={briefing.todayAppointments?.length || 0} label="today" />
        <Stat value={todos || 0} label="to-dos" />
        <Stat value={shopping || 0} label="to buy" />
      </View>
    </Pressable>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Bubble({ item }) {
  const mine = item.from === 'user';
  return (
    <View
      style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}
      accessible
      accessibilityLabel={`${mine ? 'You said' : `${brand.displayName} said`}: ${item.text}`}
    >
      <View style={[styles.bubble, mine ? styles.userBubble : styles.tiraBubble]}>
        <Text style={[styles.bubbleText, mine && styles.userBubbleText]}>{item.text}</Text>
      </View>
    </View>
  );
}

function RoundButton({ label, iconName, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <View style={styles.roundIcon}>
        <Ionicons name={iconName} size={24} color={colors.text} />
      </View>
      <Text style={styles.roundLabel}>{label}</Text>
    </Pressable>
  );
}

export default function TalkScreen() {
  const {
    ready,
    messages,
    status,
    partial,
    settings,
    voiceAvailable,
    voiceError,
    send,
    startListening,
    interrupt,
    repeatLast,
  } = useTira();
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef(null);
  const showInput = typing || !voiceAvailable;

  useEffect(() => {
    const last = messages[messages.length - 1];
    // Screen reader users get Tira's reply announced even if speech is off.
    if (last?.from === 'tira' && !settings.speakReplies) {
      AccessibilityInfo.announceForAccessibility(last.text);
    }
  }, [messages, settings.speakReplies]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(text);
  };

  const onMicPress = () => {
    if (status === 'listening' || status === 'speaking') {
      interrupt();
      return;
    }
    startListening();
  };

  const hint = !voiceAvailable
    ? 'Voice input needs the installed app build. Type below.'
    : settings.handsFree && status === 'listening'
      ? `Hands-free is on · say "${brand.displayName}, …"`
      : STATUS_LABEL[status];

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble item={item} />}
          contentContainerStyle={styles.list}
          initialNumToRender={200}
          windowSize={50}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <View style={{ gap: space(2.5), marginBottom: space(1) }}>
              <Header />
              <DayCard />
            </View>
          }
          ListEmptyComponent={
            ready ? null : <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 40 }} />
          }
          ListFooterComponent={
            partial ? (
              <View style={[styles.bubbleRow, { justifyContent: 'flex-end' }]}>
                <View style={[styles.bubble, styles.userBubble, { opacity: 0.55 }]}>
                  <Text style={[styles.bubbleText, styles.userBubbleText]}>{partial}</Text>
                </View>
              </View>
            ) : null
          }
        />

        <View style={styles.dock}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {QUICK_ACTIONS.map((a) => (
              <Pressable
                key={a.label}
                onPress={() => send(a.text)}
                disabled={!ready}
                style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.accentSoft }]}
                accessibilityRole="button"
                accessibilityLabel={a.text}
              >
                <Ionicons name={a.icon} size={18} color={colors.accent} />
                <Text style={styles.chipText}>{a.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {voiceError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {voiceError}
            </Text>
          ) : null}

          <View style={styles.controls}>
            <RoundButton label="Repeat" iconName="refresh" onPress={repeatLast} disabled={!ready || messages.length === 0} />
            <MicOrb
              status={status}
              onPress={onMicPress}
              disabled={!ready || (!voiceAvailable && status !== 'speaking') || status === 'thinking'}
              accessibilityLabel={
                status === 'listening'
                  ? 'Stop listening'
                  : status === 'speaking'
                    ? 'Stop speaking'
                    : `Talk to ${brand.displayName}`
              }
            />
            <RoundButton
              label={showInput && voiceAvailable ? 'Hide' : 'Type'}
              iconName="keypad-outline"
              onPress={() => setTyping((t) => !t)}
              disabled={!voiceAvailable}
            />
          </View>
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {hint}
          </Text>

          {showInput ? (
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={submit}
                placeholder={`Message ${brand.displayName}…`}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                returnKeyType="send"
                accessibilityLabel={`Type a message to ${brand.displayName}`}
                editable={ready}
                autoFocus={typing}
              />
              <Pressable
                onPress={submit}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [styles.send, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="arrow-up" size={24} color={colors.accentText} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: space(2.5), paddingBottom: space(2), gap: space(1.5), flexGrow: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatarFallback: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontFamily: fonts.display, fontSize: 20 },
  syncDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.bg,
  },
  date: { color: colors.textMuted, fontFamily: fonts.bodyBold, fontSize: type.tiny, letterSpacing: 0.3 },
  greeting: { color: colors.textMuted, fontFamily: fonts.displaySemi, fontSize: type.heading + 2, marginTop: 6 },
  name: { color: colors.text, fontFamily: fonts.display, fontSize: type.hero + 6, letterSpacing: -1, lineHeight: 46 },

  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space(2),
    gap: space(2),
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardKicker: { color: colors.accentMid, fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.4 },
  cardTitle: { color: colors.text, fontFamily: fonts.display, fontSize: type.heading },
  cardWhen: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small },
  statsRow: { flexDirection: 'row', gap: space(1) },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space(1.25),
    borderRadius: 14,
    backgroundColor: colors.bg,
  },
  statValue: { color: colors.accent, fontFamily: fonts.display, fontSize: type.heading + 2 },
  statLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.tiny },

  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '84%', paddingVertical: space(1.5), paddingHorizontal: space(2), borderRadius: 22 },
  tiraBubble: {
    backgroundColor: colors.tiraBubble,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userBubble: { backgroundColor: colors.userBubble, borderBottomRightRadius: 6 },
  bubbleText: { color: colors.text, fontFamily: fonts.body, fontSize: type.body, lineHeight: 28 },
  userBubbleText: { color: colors.userBubbleText },

  dock: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space(1.5),
    paddingBottom: space(1.5),
  },
  chips: { gap: space(1), paddingHorizontal: space(2) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
    minHeight: 44,
  },
  chipText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: type.tiny + 1 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: type.small, paddingHorizontal: space(2), paddingTop: space(1) },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    marginTop: space(0.5),
  },
  round: { width: 72, alignItems: 'center', gap: 4 },
  roundIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLabel: { color: colors.textMuted, fontFamily: fonts.bodyBold, fontSize: type.tiny - 1 },
  status: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small, textAlign: 'center', marginTop: -space(1) },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(2),
    marginTop: space(1.5),
  },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    paddingHorizontal: space(2),
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
