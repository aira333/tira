import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
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

import brand from '../engine/brand';
import MicOrb from '../tira/components/MicOrb';
import { useTira } from '../tira/TiraProvider';
import { colors, gradients, radius, space, type } from '../tira/theme';

const STATUS_LABEL = {
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking · tap to stop',
};

const QUICK_ACTIONS = [
  { label: "What's my day?", text: "What's my day?" },
  { label: "What's next?", text: "What's next?" },
  { label: 'Add appointment', text: 'Add an appointment' },
  { label: 'Shopping list', text: "What's on my shopping list?" },
  { label: 'To-dos', text: "What's on my to do list?" },
  { label: 'Request a ride', text: 'Request a ride to my appointment' },
  { label: 'Help', text: 'Help' },
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

function Header() {
  const { briefing } = useTira();
  const insets = useSafeAreaInsets();
  const name = briefing?.userName;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <View style={[styles.header, { paddingTop: insets.top + space(1.5) }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.greeting} accessibilityRole="header">
          {partOfDay()}
          {name ? `, ${name}` : ''}
        </Text>
      </View>
      <LinearGradient colors={gradients.accent} style={styles.avatar}>
        <Text style={styles.avatarText} accessible={false}>
          {brand.displayName[0]}
        </Text>
      </LinearGradient>
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
    `${todos || 0} to-dos`,
    `${shopping || 0} items to buy`,
  ].join('. ');

  return (
    <Pressable
      onPress={() => router.navigate('/today')}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens My Day"
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      <LinearGradient colors={gradients.card} style={styles.dayCard}>
        <Text style={styles.cardKicker}>UP NEXT</Text>
        {next ? (
          <>
            <Text style={styles.cardTitle}>{doctorLabel(next.doctorName)}</Text>
            <Text style={styles.cardWhen}>{whenLabel(next.dateTime)}</Text>
          </>
        ) : (
          <Text style={styles.cardTitle}>Nothing scheduled</Text>
        )}
        <View style={styles.statsRow}>
          <Stat value={briefing.todayAppointments?.length || 0} label="today" />
          <Stat value={todos || 0} label="to-dos" />
          <Stat value={shopping || 0} label="to buy" />
        </View>
      </LinearGradient>
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
      {!mine ? (
        <LinearGradient colors={gradients.accent} style={styles.bubbleAvatar}>
          <Text style={styles.bubbleAvatarText}>{brand.displayName[0]}</Text>
        </LinearGradient>
      ) : null}
      <View style={[styles.bubble, mine ? styles.userBubble : styles.tiraBubble]}>
        <Text style={[styles.bubbleText, mine && styles.userBubbleText]}>{item.text}</Text>
      </View>
    </View>
  );
}

function RoundButton({ label, glyph, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.roundGlyph}>{glyph}</Text>
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
    <LinearGradient colors={gradients.screen} style={styles.container}>
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
            <View style={{ gap: space(2), marginBottom: space(1) }}>
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
                <View style={[styles.bubble, styles.userBubble, { opacity: 0.6 }]}>
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
                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={a.text}
              >
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
            <RoundButton label="Repeat" glyph="↻" onPress={repeatLast} disabled={!ready || messages.length === 0} />
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
              glyph="⌨"
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
                style={({ pressed }) => [pressed && { opacity: 0.8 }]}
              >
                <LinearGradient colors={gradients.accent} style={styles.send}>
                  <Text style={styles.sendText}>Send</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: space(2), paddingBottom: space(2), gap: space(1.5), flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  date: { color: colors.textMuted, fontSize: type.small, fontWeight: '600' },
  greeting: { color: colors.text, fontSize: type.hero, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: 26, fontWeight: '900' },

  dayCard: {
    borderRadius: radius.card,
    padding: space(2.5),
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardKicker: { color: colors.accent, fontSize: type.tiny, fontWeight: '800', letterSpacing: 1.5 },
  cardTitle: { color: colors.text, fontSize: type.heading + 2, fontWeight: '800' },
  cardWhen: { color: colors.textMuted, fontSize: type.body },
  statsRow: {
    flexDirection: 'row',
    marginTop: space(2),
    paddingTop: space(1.5),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: type.heading + 4, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: type.tiny },

  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space(1) },
  bubbleAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  bubbleAvatarText: { color: colors.accentText, fontWeight: '900', fontSize: 15 },
  bubble: { maxWidth: '82%', paddingVertical: space(1.5), paddingHorizontal: space(2), borderRadius: 20 },
  tiraBubble: {
    backgroundColor: colors.tiraBubble,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userBubble: { backgroundColor: colors.userBubble, borderBottomRightRadius: 6 },
  bubbleText: { color: colors.text, fontSize: type.body, lineHeight: 28 },
  userBubbleText: { color: colors.userBubbleText, fontWeight: '600' },

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
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space(1.25),
    paddingHorizontal: space(2),
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { color: colors.text, fontSize: type.small, fontWeight: '600' },
  error: { color: colors.danger, fontSize: type.small, paddingHorizontal: space(2), paddingTop: space(1) },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    marginTop: space(0.5),
  },
  round: { width: 72, alignItems: 'center', gap: 4 },
  roundGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 24,
    textAlign: 'center',
    lineHeight: 50,
    overflow: 'hidden',
  },
  roundLabel: { color: colors.textMuted, fontSize: type.tiny, fontWeight: '600' },
  status: { color: colors.textMuted, fontSize: type.small, textAlign: 'center', marginTop: -space(1) },
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
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: type.body,
    paddingHorizontal: space(2),
  },
  send: { minHeight: 52, paddingHorizontal: space(2.5), borderRadius: 16, justifyContent: 'center' },
  sendText: { color: colors.accentText, fontSize: type.body, fontWeight: '800' },
});
