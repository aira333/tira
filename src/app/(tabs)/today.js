import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { store } from '../../engine';
import { confirm } from '../../tira/confirm';
import { devicePlatform } from '../../tira/device';
import { useTira } from '../../tira/TiraProvider';
import { colors, fonts, radius, shadow, space, type } from '../../tira/theme';

const USER_ID = 'device-user';

function titleCase(s) {
  return String(s || '').replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function doctorLabel(name) {
  const n = titleCase(name);
  return /^(dr\.?|doctor)\b/i.test(n) ? n : `Dr. ${n}`;
}

function realLocation(loc) {
  const l = String(loc || '').trim();
  return l && !/^(not specified|none|no location)$/i.test(l) ? l : '';
}

function reminderLabel(min) {
  if (!min) return null;
  if (min >= 1440) return '1 day before';
  if (min >= 60) return '1 hour before';
  return `${min} min before`;
}

function isToday(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function Section({ title, subtitle, children, empty, count }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {count ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      {count ? children : <EmptyCard text={empty} />}
    </View>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function AppointmentCard({ apt, onDelete }) {
  const d = new Date(apt.dateTime);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const longDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const loc = realLocation(apt.location);
  const reminder = reminderLabel(apt.reminderLeadMinutes);
  const today = isToday(apt.dateTime);

  return (
    <View
      style={styles.aptCard}
      accessible
      accessibilityLabel={`${doctorLabel(apt.doctorName)}, ${longDate} at ${time}${loc ? `, at ${loc}` : ''}${reminder ? `, reminder ${reminder}` : ''}`}
      accessibilityActions={[{ name: 'delete', label: 'Delete appointment' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && onDelete(apt)}
    >
      <View style={[styles.dateTile, today && styles.dateTileToday]}>
        <Text style={[styles.tileDay, today && styles.tileInk]}>{today ? 'TODAY' : weekday}</Text>
        <Text style={[styles.tileNum, today && styles.tileInk]}>{d.getDate()}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.aptTitle}>{doctorLabel(apt.doctorName)}</Text>
        <Text style={styles.aptTime}>{today ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`}</Text>
        {loc ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={15} color={colors.textMuted} />
            <Text style={styles.aptMeta}>{loc}</Text>
          </View>
        ) : null}
        {reminder ? (
          <View style={styles.metaRow}>
            <Ionicons name="notifications-outline" size={15} color={colors.textMuted} />
            <Text style={styles.aptMeta}>{reminder}</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={() => onDelete(apt)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Delete appointment with ${doctorLabel(apt.doctorName)}`}
        style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function ListCard({ name, list, kind, onToggle, onRemove }) {
  const items = list.items || [];
  const done = items.filter((i) => i.completed).length;
  const pct = items.length ? done / items.length : 0;

  return (
    <View style={styles.listCard}>
      <View style={styles.listHead}>
        <View style={styles.metaRow}>
          <Ionicons name={kind === 'shopping' ? 'cart-outline' : 'checkbox-outline'} size={20} color={colors.accent} />
          <Text style={styles.listTitle}>{titleCase(name)}</Text>
        </View>
        <Text style={styles.listProgress}>
          {done}/{items.length}
        </Text>
      </View>
      <View style={styles.bar} accessible={false}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
      </View>
      {items.length === 0 ? <Text style={styles.emptyText}>No items.</Text> : null}
      {items.map((item, i) => (
        <Pressable
          key={item.itemId || `${item.name}-${i}`}
          onPress={() => onToggle(list, i)}
          onLongPress={() => onRemove(list, i)}
          delayLongPress={450}
          style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(item.completed) }}
          accessibilityLabel={item.name}
          accessibilityHint="Double tap to check off. Long press to remove."
        >
          <View style={[styles.check, item.completed && styles.checkOn]}>
            {item.completed ? <Ionicons name="checkmark" size={18} color={colors.accentText} /> : null}
          </View>
          <Text style={[styles.itemText, item.completed && styles.itemDone]}>{item.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function TodayScreen() {
  const { dataVersion, refreshData } = useTira();
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

  const changed = () => {
    load();
    refreshData();
  };

  const deleteAppointment = async (apt) => {
    const ok = await confirm(
      'Delete appointment?',
      `${doctorLabel(apt.doctorName)} on ${new Date(apt.dateTime).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
    );
    if (!ok) return;
    if (apt.alexaReminderId) await devicePlatform.cancelReminder({ id: apt.alexaReminderId }).catch(() => {});
    await store.deleteAppointment(USER_ID, apt.appointmentId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    changed();
  };

  const toggleItem = async (kind, list, index) => {
    const item = list.items[index];
    const update = item.completed
      ? { completed: false, completedAt: null }
      : { completed: true, completedAt: new Date().toISOString() };
    if (kind === 'shopping') await store.updateItemInList(USER_ID, list.listId, index, update);
    else await store.updateTodoItemInList(USER_ID, list.listId, index, update);
    Haptics.selectionAsync().catch(() => {});
    changed();
  };

  const removeItem = async (kind, list, index) => {
    const item = list.items[index];
    const ok = await confirm('Remove item?', `Remove "${item.name}" from ${titleCase(list.storeName || list.listName)}?`, 'Remove');
    if (!ok) return;
    const next = { ...list, items: list.items.filter((_, i) => i !== index) };
    if (kind === 'shopping') await store.saveShoppingList(USER_ID, next);
    else await store.saveTodoList(USER_ID, next);
    changed();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const todayApts = appointments.filter((a) => isToday(a.dateTime));
  const laterApts = appointments.filter((a) => !isToday(a.dateTime));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Section title="Today" count={todayApts.length} empty="No appointments today. Enjoy your day!">
          {todayApts.map((apt) => (
            <AppointmentCard key={apt.appointmentId} apt={apt} onDelete={deleteAppointment} />
          ))}
        </Section>

        <Section
          title="Coming up"
          count={laterApts.length}
          empty='Nothing scheduled. Say "Tira, add an appointment".'
        >
          {laterApts.map((apt) => (
            <AppointmentCard key={apt.appointmentId} apt={apt} onDelete={deleteAppointment} />
          ))}
        </Section>

        <Section
          title="Shopping"
          subtitle={shopping.length ? 'Tap to check off · long press to remove' : null}
          count={shopping.length}
          empty='No lists yet. Say "Tira, add milk to my Target list".'
        >
          {shopping.map((list) => (
            <ListCard
              key={list.listId}
              kind="shopping"
              name={list.storeName}
              list={list}
              onToggle={(l, i) => toggleItem('shopping', l, i)}
              onRemove={(l, i) => removeItem('shopping', l, i)}
            />
          ))}
        </Section>

        <Section
          title="To-dos"
          subtitle={todos.length ? 'Tap to check off · long press to remove' : null}
          count={todos.length}
          empty='No to-dos yet. Say "Tira, add call the pharmacy to my to do list".'
        >
          {todos.map((list) => (
            <ListCard
              key={list.listId}
              kind="todo"
              name={list.listName}
              list={list}
              onToggle={(l, i) => toggleItem('todo', l, i)}
              onRemove={(l, i) => removeItem('todo', l, i)}
            />
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(2.5), gap: space(3), paddingBottom: space(6) },
  section: { gap: space(1.5) },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: type.heading + 2 },
  sectionSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.tiny, marginTop: -space(1) },
  countPill: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    minWidth: 28,
    paddingHorizontal: 9,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.accent, fontFamily: fonts.bodyBold, fontSize: type.tiny },
  emptyCard: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    padding: space(2),
  },
  emptyText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.small, lineHeight: 24 },

  aptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(1.5),
    ...shadow.card,
  },
  dateTile: {
    width: 66,
    height: 70,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  dateTileToday: { backgroundColor: colors.accent },
  tileDay: { color: colors.accentMid, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1 },
  tileNum: { color: colors.accent, fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  tileInk: { color: colors.accentText },
  aptTitle: { color: colors.text, fontFamily: fonts.display, fontSize: type.body },
  aptTime: { color: colors.text, fontFamily: fonts.body, fontSize: type.small },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aptMeta: { color: colors.textMuted, fontFamily: fonts.body, fontSize: type.tiny },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },

  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(2),
    gap: space(0.5),
    ...shadow.card,
  },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listTitle: { color: colors.text, fontFamily: fonts.display, fontSize: type.body },
  listProgress: { color: colors.textMuted, fontFamily: fonts.bodyBold, fontSize: type.small },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    marginVertical: space(1),
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.listening },
  item: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), minHeight: 48 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemText: { color: colors.text, fontFamily: fonts.body, fontSize: type.body, flexShrink: 1 },
  itemDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
});
