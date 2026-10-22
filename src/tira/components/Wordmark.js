// src/tira/components/Wordmark.js
// The "tira" wordmark: lowercase Bricolage Grotesque with a phthalo dot.

import { StyleSheet, Text, View } from 'react-native';

import brand from '../../engine/brand';
import { colors, fonts } from '../theme';

export default function Wordmark({ size = 30, color = colors.text, dotColor = colors.listening }) {
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={brand.displayName}>
      <Text style={[styles.word, { fontSize: size, lineHeight: size * 1.1, color }]}>
        {brand.displayName.toLowerCase()}
      </Text>
      <View
        style={[
          styles.dot,
          { width: size * 0.22, height: size * 0.22, borderRadius: size * 0.11, backgroundColor: dotColor, marginBottom: size * 0.16 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  word: { fontFamily: fonts.brand, letterSpacing: -1 },
  dot: {},
});
