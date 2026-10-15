// src/tira/confirm.js
// Yes/no confirmation that works on phones (Alert) and web (window.confirm).

import { Alert, Platform } from 'react-native';

/**
 * @returns {Promise<boolean>}
 */
export function confirm(title, message, confirmLabel = 'Delete') {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
