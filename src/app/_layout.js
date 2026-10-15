import { Tabs } from 'expo-router/tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TiraProvider } from '../tira/TiraProvider';
import { colors, type } from '../tira/theme';

function TabIcon({ glyph, color }) {
  return (
    <Text style={{ color, fontSize: 21, lineHeight: 26 }} accessible={false}>
      {glyph}
    </Text>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TiraProvider>
        <StatusBar style="light" />
        <AppTabs />
      </TiraProvider>
    </SafeAreaProvider>
  );
}

function AppTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgTop },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: type.title, fontWeight: '800' },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 76 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 15, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tira',
          headerShown: false,
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
  );
}
