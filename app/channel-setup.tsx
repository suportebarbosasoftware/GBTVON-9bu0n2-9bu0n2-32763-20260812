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
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';
import { getLiveCategories, getLiveStreams, LiveCategory } from '@/services/xtreamApi';
import { groupChannels, GroupedChannel } from '@/services/channelGrouper';
import { loadFilterState, isAdultCategory, setAdultBlocked, verifyParentalPin } from '@/services/channelFilterService';
import {
  saveSelectedChannelKeys,
  markSetupDone,
  makeChannelKey,
  getSelectedChannelKeys,
} from '@/services/channelSetupService';
import { useAuth } from '@/hooks/useAuth';
import { IS_TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';

const { width, height } = Dimensions.get('window');
// Percentage widths stay correct after webOS applies the TV zoom. Two large
// channel cards are easier to recognize than a compressed many-column grid.
const COLS = 2;
const CARD_W = '47%';

function isFeaturedGamesCategory(name: string): boolean {
  return /jogos?.*(destaque|hoje)|(?:destaque).*jogos?/i.test(name);
}

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
  const [featuredCategoryIds, setFeaturedCategoryIds] = useState<Set<string>>(new Set());
  const [adultBlocked, setAdultBlockedState] = useState(false);
  const [adultPinVisible, setAdultPinVisible] = useState(false);
  const [adultPin, setAdultPin] = useState('');
  const [adultPinError, setAdultPinError] = useState('');

  useEffect(() => {
    loadChannels();
  }, [auth]);

  useEffect(() => {
    applyFilter(allChannels, selectedCat, search);
  }, [selectedCat, search, allChannels, categories, adultBlocked]);

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
        return true;
      });
      setCategories(visibleCats);
      setAdultBlockedState(filters.adultBlocked);
      const featuredIds = new Set(cats.filter(c => isFeaturedGamesCategory(c.category_name)).map(c => c.category_id));
      setFeaturedCategoryIds(featuredIds);

      const grouped = groupChannels(streams).filter(g => {
        const key = makeChannelKey(g.baseName, g.categoryId);
        return !filters.hiddenChannels.includes(key);
      });
      setAllChannels(grouped);
      setFiltered(grouped);

      // Pre-select if already configured
      // The games-highlight group is part of every customer list by design.
      // It stays selected even if the customer marks/demarks other groups.
      const automaticKeys = grouped
        .filter(channel => featuredIds.has(channel.categoryId))
        .map(channel => makeChannelKey(channel.baseName, channel.categoryId));
      setSelected(new Set([...(existingKeys.size > 0 ? existingKeys : []), ...automaticKeys]));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function applyFilter(channels: GroupedChannel[], catId: string, q: string) {
    let res = channels;
    if (catId !== 'all') res = res.filter(c => c.categoryId === catId);
    if (adultBlocked) {
      const adultCategoryIds = new Set(categories.filter(item => isAdultCategory(item.category_name)).map(item => item.category_id));
      res = res.filter(channel => !adultCategoryIds.has(channel.categoryId));
    }
    if (q.trim()) {
      const lq = q.toLowerCase();
      res = res.filter(c => c.baseName.toLowerCase().includes(lq));
    }
    setFiltered(res);
  }

  function toggleChannel(channel: GroupedChannel) {
    if (featuredCategoryIds.has(channel.categoryId)) return;
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
      filtered.forEach(c => {
        if (!featuredCategoryIds.has(c.categoryId)) next.delete(makeChannelKey(c.baseName, c.categoryId));
      });
      return next;
    });
  }

  function selectCategory(catId: string) {
    const category = categories.find(item => item.category_id === catId);
    if (adultBlocked && category && isAdultCategory(category.category_name)) {
      setAdultPin('');
      setAdultPinError('');
      setAdultPinVisible(true);
      return;
    }
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
      const toSave = selected.size > 0 ? new Set(selected) : new Set(allChannels.map(c => makeChannelKey(c.baseName, c.categoryId)));
      allChannels.filter(channel => featuredCategoryIds.has(channel.categoryId)).forEach(channel => {
        toSave.add(makeChannelKey(channel.baseName, channel.categoryId));
      });
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

  async function toggleAdultCategory(category: LiveCategory) {
    if (!isAdultCategory(category.category_name)) return;
    if (adultBlocked) {
      setAdultPin('');
      setAdultPinError('');
      setAdultPinVisible(true);
      return;
    }
    await setAdultBlocked(true);
    setAdultBlockedState(true);
    setSelectedCat('all');
    // Protected channels must not remain in a saved customer list after lock.
    const adultIds = new Set(categories.filter(item => isAdultCategory(item.category_name)).map(item => item.category_id));
    setSelected(previous => new Set([...previous].filter(key => ![...adultIds].some(id => key.startsWith(`${id}::`)))));
  }

  async function unlockAdultCategory() {
    if (adultPin.length !== 4) { setAdultPinError('Digite os 4 números do PIN'); return; }
    if (!(await verifyParentalPin(adultPin))) { setAdultPinError('PIN incorreto'); return; }
    await setAdultBlocked(false);
    setAdultBlockedState(false);
    setAdultPinVisible(false);
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

      {/* CATEGORY SIDEBAR + CHANNEL GRID */}
      <View style={styles.setupBody}>
        <ScrollView
          style={styles.categorySidebar}
          contentContainerStyle={styles.catBar}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.categoryTitle}>GRUPOS</Text>
          <TVFocusable
            style={[styles.catChip, selectedCat === 'all' && styles.catChipActive]}
            onPress={() => setSelectedCat('all')}
          >
            <Text numberOfLines={2} style={[styles.catChipText, selectedCat === 'all' && styles.catChipTextActive]}>
              Todos ({totalCount})
            </Text>
          </TVFocusable>
          {categories.map(cat => {
            const count = allChannels.filter(c => c.categoryId === cat.category_id).length;
            const isCatSel = selectedCat === cat.category_id;
            return (
              <TVFocusable
                key={cat.category_id}
                style={[styles.catChip, isCatSel && styles.catChipActive]}
                onPress={() => setSelectedCat(cat.category_id)}
                onLongPress={() => isAdultCategory(cat.category_name) ? void toggleAdultCategory(cat) : selectCategory(cat.category_id)}
                delayLongPress={400}
              >
                <Text numberOfLines={2} style={[styles.catChipText, isCatSel && styles.catChipTextActive]}>
                  {cat.category_name}{featuredCategoryIds.has(cat.category_id) ? ' • sempre incluído' : adultBlocked && isAdultCategory(cat.category_name) ? ' • bloqueado' : ''} ({count})
                </Text>
              </TVFocusable>
            );
          })}
        </ScrollView>
        <View style={styles.gridArea}>
          <View style={styles.hintRow}>
            <Ionicons name="information-circle-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.hintText}>  Escolha um grupo e selecione os canais</Text>
          </View>
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
        </View>
      </View>

      <Modal visible={adultPinVisible} transparent animationType="fade" onRequestClose={() => setAdultPinVisible(false)}>
        <View style={styles.pinBackdrop}>
          <View style={styles.pinSheet}>
            <Ionicons name="lock-closed" size={34} color={Colors.primary} />
            <Text style={styles.pinTitle}>Canais adultos bloqueados</Text>
            <Text style={styles.pinText}>Digite o PIN para liberar este grupo</Text>
            <View style={styles.pinDots}>{[0, 1, 2, 3].map(index => <View key={index} style={[styles.pinDot, adultPin.length > index && styles.pinDotFilled]} />)}</View>
            {adultPinError ? <Text style={styles.pinError}>{adultPinError}</Text> : null}
            <View style={styles.pinGrid}>{['1','2','3','4','5','6','7','8','9','⌫','0','OK'].map(key => (
              <TVFocusable key={key} style={[styles.pinKey, key === 'OK' && styles.pinKeyConfirm]} onPress={() => {
                if (key === 'OK') { void unlockAdultCategory(); return; }
                if (key === '⌫') { setAdultPin(value => value.slice(0, -1)); setAdultPinError(''); return; }
                if (adultPin.length < 4) { setAdultPin(value => value + key); setAdultPinError(''); }
              }}><Text style={styles.pinKeyText}>{key}</Text></TVFocusable>
            ))}</View>
            <TVFocusable style={styles.pinCancel} onPress={() => setAdultPinVisible(false)}><Text style={styles.pinCancelText}>Cancelar</Text></TVFocusable>
          </View>
        </View>
      </Modal>

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

  setupBody: { flex: 1, flexDirection: 'row', minHeight: 0 },
  categorySidebar: {
    width: '27%',
    flexShrink: 0,
    backgroundColor: '#101010',
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  catBar: { padding: IS_TV ? 12 : 10, gap: IS_TV ? 8 : 8 },
  categoryTitle: { color: Colors.textMuted, fontSize: IS_TV ? 15 : 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 2 },
  catChip: {
    width: '100%',
    minHeight: IS_TV ? 50 : 38,
    paddingHorizontal: IS_TV ? 12 : 12,
    paddingVertical: IS_TV ? 8 : 6,
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.bgCardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { color: Colors.textSecondary, fontSize: IS_TV ? 15 : 11, fontWeight: '600' },
  catChipTextActive: { color: '#fff', fontWeight: '700' },

  gridArea: { width: '73%', flexGrow: 0, minWidth: 0 },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 4,
  },
  hintText: { color: Colors.textMuted, fontSize: 10 },

  gridContent: { paddingHorizontal: 12, paddingBottom: 16 },
  gridRow: { gap: 10, marginBottom: 10, justifyContent: 'space-between' },

  channelCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: BorderRadius.md,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    position: 'relative',
    minHeight: IS_TV ? 86 : 100,
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
    width: IS_TV ? 40 : 48,
    height: IS_TV ? 40 : 48,
    borderRadius: 8,
    backgroundColor: Colors.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 6,
  },
  channelLogoImg: { width: IS_TV ? 40 : 48, height: IS_TV ? 40 : 48 },
  channelName: {
    color: Colors.textSecondary,
    fontSize: IS_TV ? 9 : 10,
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

  pinBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  pinSheet: { width: '100%', maxWidth: 390, backgroundColor: '#151515', borderRadius: 18, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(229,0,0,0.45)' },
  pinTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  pinText: { color: Colors.textSecondary, fontSize: 14, marginTop: 6, textAlign: 'center' },
  pinDots: { flexDirection: 'row', gap: 14, marginVertical: 18 },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  pinDotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pinError: { color: Colors.error, marginBottom: 10 },
  pinGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  pinKey: { width: 82, height: 50, borderRadius: 10, backgroundColor: Colors.bgCardElevated, alignItems: 'center', justifyContent: 'center' },
  pinKeyConfirm: { backgroundColor: Colors.primary },
  pinKeyText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  pinCancel: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 24 },
  pinCancelText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '700' },

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
