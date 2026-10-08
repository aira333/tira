import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { store } from '../engine';
import { useTira } from '../tira/TiraProvider';
import { colors, space, type } from '../tira/theme';

const USER_ID = 'device-user';

function titleCase(s) {
  return String(s || '').replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function formatWhen(apt) {
  const d = new Date(apt.dateTime);
  if (Number.isNaN(d.getTime())) return `${apt.date} ${apt.time}`;
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

function doctorLabel(name) {
  const n = titleCase(name);
  return /^(dr\.?|doctor)\b/i.test(n) ? n : `Dr. ${n}`;
}

function realLocation(loc) {
  const l = String(loc || '').trim();
  return l && !/^(not specified|none|no location)$/i.test(l) ? l : '';
}

function Section({ title, empty, children, count }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
        {count ? ` (${count})` : ''}
      </Text>
      {count ? children : <Text style={styles.empty}>{empty}</Text>}
    </View>
  );
}

function ListCard({ name, list, table, onChanged }) {
  const items = list.items || [];
  const toggle = async (index) => {
    const item = items[index];
    const update = item.completed
      ? { completed: false, completedAt: null }
      : { completed: true, completedAt: new Date().toISOString() };
    if (table === 'shopping') await store.updateItemInList(USER_ID, list.listId, index, update);
    else await store.updateTodoItemInList(USER_ID, list.listId, index, update);
    onChanged();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{titleCase(name)}</Text>
      {items.length === 0 ? <Text style={styles.empty}>No items.</Text> : null}
      {items.map((item, i) => (
        <Pressable
          key={item.itemId || `${item.name}-${i}`}
          onPress={() => toggle(i)}
          style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(item.completed) }}
          accessibilityLabel={item.name}
        >
          <Text style={[styles.check, item.completed && styles.checkOn]}>{item.completed ? '✓' : ''}</Text>
          <Text style={[styles.itemText, item.completed && styles.itemDone]}>{item.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function TodayScreen() {
  const { dataVersion } = useTira();
  const [appointments, setAppointments] = useState([]);
  const [shopping, setShopping] = useState([]);
  const [todos, setTodos] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const [apts, shop, todo] = await Promise.all([
      store.queryAppointmentsByDateRange(USER_ID, { fromIso: nowIso }),
      store.getAllShoppingLists(USER_ID),
      store.getAllTodoLists(USER_ID),
    ]);
    setAppointments(apts);
    setShopping(shop);
    setTodos(todo);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    load();
  }, [dataVersion, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <Section
        title="Upcoming appointments"
        count={appointments.length}
        empty='None yet. Say "Tira, add an appointment".'
      >
        {appointments.map((apt) => (
          <View
            key={apt.appointmentId}
            style={styles.card}
            accessible
            accessibilityLabel={`${doctorLabel(apt.doctorName)}, ${formatWhen(apt)}${realLocation(apt.location) ? `, at ${realLocation(apt.location)}` : ''}`}
          >
            <Text style={styles.cardTitle}>{doctorLabel(apt.doctorName)}</Text>
            <Text style={styles.cardLine}>{formatWhen(apt)}</Text>
            {realLocation(apt.location) ? <Text style={styles.cardMuted}>{realLocation(apt.location)}</Text> : null}
            {apt.reminderLeadMinutes ? (
              <Text style={styles.cardMuted}>
                Reminder {apt.reminderLeadMinutes >= 1440 ? '1 day' : apt.reminderLeadMinutes >= 60 ? '1 hour' : `${apt.reminderLeadMinutes} minutes`} before
              </Text>
            ) : null}
          </View>
        ))}
      </Section>

      <Section
        title="Shopping lists"
        count={shopping.length}
        empty='None yet. Say "Tira, add milk to my Target list".'
      >
        {shopping.map((list) => (
          <ListCard key={list.listId} name={list.storeName} list={list} table="shopping" onChanged={load} />
        ))}
      </Section>

      <Section
        title="To-do lists"
        count={todos.length}
        empty='None yet. Say "Tira, add call the pharmacy to my to do list".'
      >
        {todos.map((list) => (
          <ListCard key={list.listId} name={list.listName} list={list} table="todo" onChanged={load} />
        ))}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(3), paddingBottom: space(6) },
  section: { gap: space(1.5) },
  sectionTitle: { color: colors.text, fontSize: type.heading, fontWeight: '700' },
  empty: { color: colors.textMuted, fontSize: type.small, lineHeight: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(2),
    gap: space(0.5),
  },
  cardTitle: { color: colors.text, fontSize: type.body, fontWeight: '700' },
  cardLine: { color: colors.text, fontSize: type.body },
  cardMuted: { color: colors.textMuted, fontSize: type.small },
  item: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), minHeight: 48 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
    color: colors.accentText,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    overflow: 'hidden',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemText: { color: colors.text, fontSize: type.body, flexShrink: 1 },
  itemDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
});
