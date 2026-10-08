import { Tabs } from 'expo-router/tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TiraProvider } from '../tira/TiraProvider';
import { colors, type } from '../tira/theme';

function TabIcon({ glyph, color }) {
  return (
    <Text style={{ color, fontSize: 22 }} accessible={false}>
      {glyph}
    </Text>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TiraProvider>
        <StatusBar style="light" />
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontSize: type.heading, fontWeight: '700' },
            headerShadowVisible: false,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              height: 72,
              paddingBottom: 10,
              paddingTop: 6,
            },
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 15, fontWeight: '600' },
            sceneStyle: { backgroundColor: colors.bg },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Tira',
              tabBarLabel: 'Talk',
              tabBarAccessibilityLabel: 'Talk to Tira',
              tabBarIcon: ({ color }) => <TabIcon glyph="🎙" color={color} />,
            }}
          />
          <Tabs.Screen
            name="today"
            options={{
              title: 'My Day',
              tabBarLabel: 'My Day',
              tabBarAccessibilityLabel: 'My appointments and lists',
              tabBarIcon: ({ color }) => <TabIcon glyph="📋" color={color} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarLabel: 'Settings',
              tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
            }}
          />
        </Tabs>
      </TiraProvider>
    </SafeAreaProvider>
  );
}
