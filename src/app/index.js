import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import brand from '../engine/brand';
import { useTira } from '../tira/TiraProvider';
import { colors, space, type } from '../tira/theme';

const STATUS_LABEL = {
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap to stop',
};

const SUGGESTIONS = [
  'What appointments do I have?',
  'Add an appointment',
  "What's on my shopping list?",
  'Request a ride to my appointment',
  'Help',
];

function Bubble({ item }) {
  const mine = item.from === 'user';
  return (
    <View
      style={[styles.bubble, mine ? styles.userBubble : styles.tiraBubble]}
      accessible
      accessibilityLabel={`${mine ? 'You said' : `${brand.displayName} said`}: ${item.text}`}
    >
      <Text style={[styles.bubbleText, mine && styles.userBubbleText]}>{item.text}</Text>
    </View>
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
  } = useTira();
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

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

  const busy = status !== 'idle';
  const micColor = status === 'listening' ? colors.listening : colors.accent;
  const hint = !voiceAvailable
    ? 'Voice input needs a development build. You can type below.'
    : settings.handsFree && status === 'listening'
      ? `Hands-free is on. Say "${brand.displayName}, …" any time.`
      : STATUS_LABEL[status];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble item={item} />}
        contentContainerStyle={styles.list}
        initialNumToRender={200}
        windowSize={50}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          ready ? null : <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 40 }} />
        }
        ListFooterComponent={
          partial ? (
            <View style={[styles.bubble, styles.userBubble, styles.partial]}>
              <Text style={[styles.bubbleText, styles.userBubbleText]}>{partial}</Text>
            </View>
          ) : null
        }
      />

      {messages.length <= 1 && ready ? (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => send(s)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityHint="Sends this request to Tira"
            >
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {voiceError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {voiceError}
        </Text>
      ) : null}

      <View style={styles.controls}>
        <Pressable
          onPress={onMicPress}
          disabled={!ready || (!voiceAvailable && status !== 'speaking') || status === 'thinking'}
          style={({ pressed }) => [
            styles.mic,
            { backgroundColor: micColor, opacity: !voiceAvailable && status !== 'speaking' ? 0.4 : 1 },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            status === 'listening'
              ? 'Stop listening'
              : status === 'speaking'
                ? 'Stop speaking'
                : `Talk to ${brand.displayName}`
          }
          accessibilityState={{ busy }}
        >
          {status === 'thinking' ? (
            <ActivityIndicator color={colors.accentText} size="large" />
          ) : (
            <Text style={styles.micGlyph}>{status === 'listening' || status === 'speaking' ? '■' : '🎙'}</Text>
          )}
        </Pressable>
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {hint}
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            placeholder={`Type to ${brand.displayName}…`}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            returnKeyType="send"
            accessibilityLabel={`Type a message to ${brand.displayName}`}
            editable={ready}
          />
          <Pressable
            onPress={submit}
            style={({ pressed }) => [styles.send, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space(2), gap: space(1.5), flexGrow: 1 },
  bubble: {
    maxWidth: '88%',
    paddingVertical: space(1.5),
    paddingHorizontal: space(2),
    borderRadius: 18,
  },
  tiraBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.tiraBubble,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  partial: { opacity: 0.6 },
  bubbleText: { color: colors.text, fontSize: type.body, lineHeight: 28 },
  userBubbleText: { color: colors.userBubbleText, fontWeight: '600' },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1),
    paddingHorizontal: space(2),
    paddingBottom: space(1),
  },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: space(1),
    paddingHorizontal: space(2),
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { color: colors.text, fontSize: type.small },
  error: {
    color: colors.danger,
    fontSize: type.small,
    paddingHorizontal: space(2),
    paddingBottom: space(1),
  },
  controls: {
    alignItems: 'center',
    paddingTop: space(1),
    paddingBottom: space(1.5),
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  mic: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micGlyph: { fontSize: 40, color: colors.accentText },
  status: {
    color: colors.textMuted,
    fontSize: type.small,
    marginTop: space(1),
    marginBottom: space(1.5),
    textAlign: 'center',
    paddingHorizontal: space(2),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(2),
    width: '100%',
  },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: type.body,
    paddingHorizontal: space(2),
  },
  send: {
    minHeight: 52,
    paddingHorizontal: space(2.5),
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
  },
  sendText: { color: colors.text, fontSize: type.body, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
