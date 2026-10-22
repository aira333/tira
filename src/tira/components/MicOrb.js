// src/tira/components/MicOrb.js
// The big talk button: glowing orb with pulse rings while listening.

import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, gradients } from '../theme';

const SIZE = 104;

function Ring({ delay, color, active }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, delay, progress]);

  return (
    <Animated.View
      style={[
        styles.ring,
        { pointerEvents: 'none' },
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
        },
      ]}
    />
  );
}

/**
 * @param {{ status: 'idle'|'listening'|'thinking'|'speaking', disabled?: boolean,
 *           onPress: () => void, accessibilityLabel: string }} props
 */
export default function MicOrb({ status, disabled, onPress, accessibilityLabel }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const listening = status === 'listening';
  const speaking = status === 'speaking';

  useEffect(() => {
    if (!speaking) {
      breathe.stopAnimation();
      breathe.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, speaking]);

  const gradient =
    status === 'listening' ? gradients.listening : status === 'thinking' ? gradients.thinking : gradients.accent;
  const ringColor = listening ? colors.listening : colors.accentMid;

  return (
    <View style={styles.wrap}>
      <Ring delay={0} color={ringColor} active={listening} />
      <Ring delay={530} color={ringColor} active={listening} />
      <Ring delay={1060} color={ringColor} active={listening} />
      <Animated.View
        style={{
          transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
        }}
      >
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: Boolean(disabled), busy: status === 'thinking' }}
          style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}
        >
          <LinearGradient colors={gradient} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.orb}>
            {status === 'thinking' ? (
              <ActivityIndicator color={colors.accentText} size="large" />
            ) : listening || speaking ? (
              <Ionicons name="stop" size={34} color={colors.accentText} />
            ) : (
              <Ionicons name="mic" size={46} color={colors.accentText} />
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE * 1.9, height: SIZE * 1.5, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 3,
  },
  orb: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
});
