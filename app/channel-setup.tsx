import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import { getLiveCategories, getLiveStreams, LiveCategory } from '@/services/xtreamApi';
import { groupChannels, GroupedChannel } from '@/services/channelGrouper';
import { loadFilterState, isAdultCategory } from '@/services/channelFilterService';
import {
  saveSelectedChannelKeys,
  markSetupDone,
  makeChannelKey,
  getSelectedChannelKeys,
} from '@/services/channelSetupService';
import { useAuth } from '@/hooks/useAuth';

const { width, height } = Dimensions.get('window');
const COLS = width > 900 ? 5 : width > 600 ? 4 : 3;
const CARD_W = (width - 32 - (COLS - 1) * 10) / COLS;

export default function ChannelSetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { auth } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<LiveCategory[]>([]);
  const [allChannels, setAllChannels] = useState<GroupedChannel[]>([]);
  const [filtered, setFiltered] = useState<GroupedChannel[]>([]);
  const [selectedCat, setSelectedCat] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'select' | 'confirm'>('select');

  useEffect(() => {
    loadChannels();
  }, [auth]);

  useEffect(() => {
    applyFilter(allChannels, selectedCat, search);
  }, [selectedCat, search, allChannels]);

  async function loadChannels() {
    if (!auth) return;
    setLoading(true);
    try {
      const [cats, streams, filters, existingKeys] = await Promise.all([
        getLiveCategories(auth),
        getLiveStreams(auth),
        loadFilterState(),
        getSelectedChannelKeys(),
      ]);

      const visibleCats = cats.filter(c => {
        if (filters.hiddenCategories.includes(c.category_id)) return false;
        if (filters.adultBlocked && isAdultCategory(c.category_name)) return false;
        return true;
      });
      setCategories(visibleCats);

      const grouped = groupChannels(streams).filter(g => {
        const key = makeChannelKey(g.baseName, g.categoryId);
        return !filters.hiddenChannels.includes(key);
      });
      setAllChannels(grouped);
      setFiltered(grouped);

      // Pre-select if already configured
      if (existingKeys.size > 0) {
        setSelected(new Set(existingKeys));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function applyFilter(channels: GroupedChannel[], catId: string, q: string) {
    let res = channels;
    if (catId !== 'all') res = res.filter(c => c.categoryId === catId);
    if (q.trim()) {
      const lq = q.toLowerCase();
      res = res.filter(c => c.baseName.toLowerCase().includes(lq));
    }
    setFiltered(res);
  }

  function toggleChannel(channel: GroupedChannel) {
    const key = makeChannelKey(channel.baseName, channel.categoryId);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(c => next.add(makeChannelKey(c.baseName, c.categoryId)));
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(c => next.delete(makeChannelKey(c.baseName, c.categoryId)));
      return next;
    });
  }

  function selectCategory(catId: string) {
    // Select all channels of this category
    const catChannels = allChannels.filter(c => c.categoryId === catId);
    setSelected(prev => {
      const next = new Set(prev);
      catChannels.forEach(c => next.add(makeChannelKey(c.baseName, c.categoryId)));
      return next;
    });
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      // If nothing selected, select all
      const toSave = selected.size > 0 ? selected : new Set(allChannels.map(c => makeChannelKey(c.baseName, c.categoryId)));
      await saveSelectedChannelKeys(toSave);
      await markSetupDone();
      router.replace('/(tabs)');
    } catch {
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    // Save all channels and mark done
    const allKeys = new Set(allChannels.map(c => makeChannelKey(c.baseName, c.categoryId)));
    await saveSelectedChannelKeys(allKeys);
    await markSetupDone();
    router.replace('/(tabs)');
  }

  const selectedCount = selected.size;
  const totalCount = allChannels.length;

  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selected.has(makeChannelKey(c.baseName, c.categoryId)));

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.loadingLogo}
          contentFit="contain"
        />
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 24 }} />
        <Text style={styles.loadingText}>Carregando canais disponíveis...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.headerLogo}
          contentFit="contain"
        />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Monte sua lista de canais</Text>
          <Text style={styles.headerSubtitle}>Escolha os canais que deseja assistir</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.selCountBadge}>
            <Text style={styles.selCountText}>{selectedCount} selecionados</Text>
          </View>
          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipText}>Pular</Text>
          </Pressable>
        </View>
      </View>

      {/* SEARCH + BULK ACTIONS */}
      <View style={styles.toolbarRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar canal..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable style={styles.bulkBtn} onPress={allVisibleSelected ? deselectAllVisible : selectAllVisible}>
          <Ionicons
            name={allVisibleSelected ? 'checkbox' : 'checkbox-outline'}
            size={16}
            color={allVisibleSelected ? Colors.primary : Colors.textSecondary}
          />
          <Text style={[styles.bulkBtnText, allVisibleSelected && { color: Colors.primary }]}>
            {allVisibleSelected ? 'Desmarcar' : 'Marcar todos'}
          </Text>
        </Pressable>
      </View>

      {/* CATEGORIES */}
      <View style={styles.catBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar}>
          <Pressable
            style={[styles.catChip, selectedCat === 'all' && styles.catChipActive]}
            onPress={() => setSelectedCat('all')}
          >
            <Text style={[styles.catChipText, selectedCat === 'all' && styles.catChipTextActive]}>
              Todos ({totalCount})
            </Text>
          </Pressable>
          {categories.map(cat => {
            const count = allChannels.filter(c => c.categoryId === cat.category_id).length;
            const isCatSel = selectedCat === cat.category_id;
            return (
              <Pressable
                key={cat.category_id}
                style={[styles.catChip, isCatSel && styles.catChipActive]}
                onPress={() => setSelectedCat(cat.category_id)}
                onLongPress={() => selectCategory(cat.category_id)}
                delayLongPress={400}
              >
                <Text style={[styles.catChipText, isCatSel && styles.catChipTextActive]}>
                  {cat.category_name} ({count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* HINT */}
      <View style={styles.hintRow}>
        <Ionicons name="information-circle-outline" size={13} color={Colors.textMuted} />
        <Text style={styles.hintText}>  Toque para selecionar • Segure a categoria para selecionar todos</Text>
      </View>

      {/* CHANNEL GRID */}
      <FlatList
        data={filtered}
        keyExtractor={item => `${item.categoryId}::${item.baseName}`}
        numColumns={COLS}
        key={`setup-grid-${COLS}`}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const key = makeChannelKey(item.baseName, item.categoryId);
          const isSelected = selected.has(key);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.channelCard,
                { width: CARD_W },
                isSelected && styles.channelCardSelected,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => toggleChannel(item)}
            >
              {/* Selection indicator */}
              <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                {isSelected && <Ionicons name="checkmark" size={11} color="#fff" />}
              </View>

              {/* Logo */}
              <View style={styles.channelLogo}>
                {item.icon ? (
                  <Image source={{ uri: item.icon }} style={styles.channelLogoImg} contentFit="contain" />
                ) : (
                  <Ionicons name="tv" size={28} color={isSelected ? Colors.primary : Colors.textMuted} />
                )}
              </View>

              {/* Name */}
              <Text style={[styles.channelName, isSelected && styles.channelNameSelected]} numberOfLines={2}>
                {item.baseName}
              </Text>

              {/* Quality badges */}
              {item.qualities.length > 1 && (
                <View style={styles.qRow}>
                  {item.qualities.slice(0, 3).map(q => (
                    <View key={q.label} style={[styles.qBadge, isSelected && styles.qBadgeSelected]}>
                      <Text style={[styles.qBadgeText, isSelected && styles.qBadgeTextSelected]}>{q.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="live-tv" size={52} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Nenhum canal encontrado</Text>
          </View>
        }
      />

      {/* BOTTOM CONFIRM BAR */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}>
        <View style={styles.bottomInfo}>
          <Text style={styles.bottomCount}>
            <Text style={styles.bottomCountNum}>{selectedCount}</Text>
            <Text style={styles.bottomCountLabel}> canais selecionados</Text>
          </Text>
          <Text style={styles.bottomHint}>
            {selectedCount === 0 ? 'Selecione os canais que deseja ver' : 'Você pode alterar isso depois nas configurações'}
          </Text>
        </View>
        <Pressable
          style={[styles.confirmBtn, selectedCount === 0 && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.confirmBtnText}>  {selectedCount === 0 ? 'Continuar com todos' : 'Confirmar seleção'}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  loadingScreen: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  loadingLogo: { width: 100, height: 100, borderRadius: 16 },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  headerLogo: { width: 40, height: 40, borderRadius: 8 },
  headerText: { flex: 1 },
  headerTitle: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
  headerSubtitle: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selCountBadge: {
    backgroundColor: 'rgba(229,0,0,0.18)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(229,0,0,0.3)',
  },
  selCountText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
  skipBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  skipText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgInput,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10,
    height: 38,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  bulkBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '600' },

  catBarWrap: { height: 44 },
  catBar: { paddingHorizontal: 12, alignItems: 'center', gap: 8 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.bgCardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
  catChipTextActive: { color: '#fff', fontWeight: '700' },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 4,
  },
  hintText: { color: Colors.textMuted, fontSize: 10 },

  gridContent: { paddingHorizontal: 12, paddingBottom: 16 },
  gridRow: { gap: 10, marginBottom: 10 },

  channelCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: BorderRadius.md,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    position: 'relative',
    minHeight: 100,
    justifyContent: 'center',
  },
  channelCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(229,0,0,0.1)',
  },
  checkCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  channelLogo: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: Colors.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 6,
  },
  channelLogoImg: { width: 48, height: 48 },
  channelName: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 14,
  },
  channelNameSelected: { color: '#fff' },
  qRow: { flexDirection: 'row', gap: 3, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  qBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  qBadgeSelected: {
    backgroundColor: 'rgba(229,0,0,0.2)',
    borderColor: 'rgba(229,0,0,0.4)',
  },
  qBadgeText: { color: Colors.textMuted, fontSize: 7, fontWeight: '700' },
  qBadgeTextSelected: { color: Colors.primary },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingBottom: 20 },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 12 },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#0d0d0d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(229,0,0,0.2)',
    gap: 16,
  },
  bottomInfo: { flex: 1 },
  bottomCount: {},
  bottomCountNum: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: '800' },
  bottomCountLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  bottomHint: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
    shadowColor: '#E50000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  confirmBtnDisabled: { backgroundColor: '#7a0000' },
  confirmBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '700' },
});
