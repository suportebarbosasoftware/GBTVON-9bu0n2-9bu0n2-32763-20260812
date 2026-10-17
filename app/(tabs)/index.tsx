/**
 * Live TV Screen — channels grouped by broadcaster (Globo, SBT, Band, etc.)
 * with section headers + fast loading via parallel fetch.
 */
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  SectionList,
  ScrollView,
  Dimensions,
  Modal,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveTV } from '@/hooks/useLiveTV';
import { Colors, Spacing, BorderRadius } from '@/constants/theme';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { GroupedChannel } from '@/services/channelGrouper';
import { getDeviceProfile } from '@/services/deviceService';
import { verifyParentalPin, setParentalPin, setAdultBlocked, isAdultCategory } from '@/services/channelFilterService';
import { resetSetup } from '@/services/channelSetupService';
import { IS_TV, TV } from '@/hooks/useTV';
import TVFocusable from '@/components/ui/TVFocusable';
import { NumberedChannel } from '@/services/channelNumberService';
import { getShortEpg, EpgProgram } from '@/services/xtreamApi';
import { useAuth } from '@/hooks/useAuth';

const device = getDeviceProfile();
const { width } = Dimensions.get('window');
const F = TV.fontSize;
const SP = TV.spacing;

// Known broadcaster groups — channels whose names contain these keywords
// are grouped under that section label.
const CHANNEL_GROUPS: { label: string; keywords: string[] }[] = [
  { label: 'Globo',       keywords: ['globo', 'gshow', 'multishow', 'sportv', 'globoplay', 'off', 'viva', 'bis'] },
  { label: 'SBT',         keywords: ['sbt'] },
  { label: 'Band',        keywords: ['band', 'bandeirantes', 'bandsports', 'bandnews'] },
  { label: 'Record',      keywords: ['record', 'recordnews', 'r7'] },
  { label: 'RedeTV',      keywords: ['redetv'] },
  { label: 'Cultura',     keywords: ['cultura', 'tv cultura'] },
  { label: 'CNN',         keywords: ['cnn'] },
  { label: 'Esportes',    keywords: ['esporte', 'sport', 'futebol', 'fox sports', 'espn', 'dazn', 'combate', 'premiere', 'nfl', 'nba'] },
  { label: 'Notícias',    keywords: ['news', 'notícia', 'noticia', 'jornal', 'globonews', 'jovem pan'] },
  { label: 'Filmes/Séries', keywords: ['hbo', 'max', 'paramount', 'discovery', 'netflix', 'telecine', 'cinemax', 'fx ', 'amc', 'tnt', 'tbs', 'axn'] },
  { label: 'Infantil',    keywords: ['cartoon', 'disney', 'nick', 'discovery kids', 'baby', 'infantil', 'gloob', 'boomerang'] },
  { label: 'Documentário',keywords: ['nat geo', 'natgeo', 'history', 'animal planet', 'discovery channel'] },
  { label: 'Música',      keywords: ['mtv', 'music', 'vh1', 'clube'] },
];

function getGroupLabel(name: string): string {
  const lower = name.toLowerCase();
  for (const g of CHANNEL_GROUPS) {
    if (g.keywords.some(k => lower.includes(k))) return g.label;
  }
  return 'Outros';
}

interface Section {
  title: string;
  data: NumberedChannel[];
}

function buildSections(channels: NumberedChannel[]): Section[] {
  const map = new Map<string, NumberedChannel[]>();
  for (const ch of channels) {
    const label = getGroupLabel(ch.baseName);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(ch);
  }
  // Order: known groups first, then Outros
  const ordered: Section[] = [];
  const knownLabels = CHANNEL_GROUPS.map(g => g.label);
  for (const label of knownLabels) {
    if (map.has(label)) ordered.push({ title: label, data: map.get(label)! });
  }
  if (map.has('Outros')) ordered.push({ title: 'Outros', data: map.get('Outros')! });
  return ordered;
}

export default function LiveTVScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { auth } = useAuth();
  const {
    categories,
    groupedChannels,
    selectedCategory,
    loading,
    searchQuery,
    setSearchQuery,
    selectCategory,
    getStreamUrl,
    hideChannelByKey,
    hideCategoryById,
    refresh,
    filterState,
  } = useLiveTV();

  const [showGroups, setShowGroups] = useState(true);
  const [epgByStream, setEpgByStream] = useState<Record<number, EpgProgram[]>>({});
  const epgRequested = useRef<Set<number>>(new Set());
  const catScrollRef = useRef<ScrollView>(null);
  // Refs for TV D-Pad focus-based scrolling
  const flatListRef = useRef<FlatList>(null);
  const sectionListRef = useRef<SectionList>(null);

  const sections = useMemo<Section[]>(() => {
    if (!showGroups || searchQuery.trim() || selectedCategory !== 'all') return [];
    return buildSections(groupedChannels);
  }, [groupedChannels, showGroups, searchQuery, selectedCategory]);

  const loadChannelEpg = useCallback((channel: NumberedChannel) => {
    if (!auth || epgRequested.current.has(channel.primaryStreamId)) return;
    epgRequested.current.add(channel.primaryStreamId);
    void getShortEpg(auth, channel.primaryStreamId, 3).then(programs => {
      setEpgByStream(previous => ({ ...previous, [channel.primaryStreamId]: programs }));
    }).catch(() => {});
  }, [auth]);

  // Load the programs that are on screen before a channel is opened. Extra
  // rows are loaded when they receive D-Pad focus, avoiding thousands of EPG
  // requests for a large provider list.
  useEffect(() => {
    groupedChannels.slice(0, 18).forEach(loadChannelEpg);
  }, [groupedChannels, loadChannelEpg]);

  // ─── Parental PIN modal ─────────────────────────────────────────
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAction, setPinAction] = useState<'unblock_adult' | 'change_pin' | null>(null);
  const [pinError, setPinError] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinStep, setNewPinStep] = useState(false);
  const [pendingAdultCategoryId, setPendingAdultCategoryId] = useState<string | null>(null);

  // Each fresh visit starts with adult content protected. The group remains
  // visible with a lock, and only a valid PIN reveals its channels.
  useEffect(() => {
    void setAdultBlocked(true).then(() => refresh());
  }, []);

  // ─── Options modals ─────────────────────────────────────────────
  const [channelOptionsModal, setChannelOptionsModal] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<GroupedChannel | null>(null);

  function handlePlay(channel: GroupedChannel) {
    const primaryQuality = channel.qualities[0];
    const allQualities = channel.qualities.map(q => ({
      label: q.label,
      streamId: q.streamId,
      url: getStreamUrl(q.streamId),
    }));
    router.push({
      pathname: '/player',
      params: {
        url: getStreamUrl(primaryQuality.streamId),
        title: channel.baseName,
        type: 'live',
        poster: channel.icon,
        contentId: String(primaryQuality.streamId),
        qualitiesJson: JSON.stringify(allQualities),
      },
    });
  }

  function openPinModal(action: 'unblock_adult' | 'change_pin') {
    setPinAction(action);
    setPinInput('');
    setPinError('');
    setNewPin('');
    setNewPinStep(false);
    setPinModalVisible(true);
  }

  async function handlePinSubmit() {
    if (newPinStep) {
      if (newPin.length < 4) { setPinError('PIN deve ter 4 dígitos'); return; }
      await setParentalPin(newPin);
      setPinModalVisible(false);
      Alert.alert('Sucesso', 'PIN alterado!');
      return;
    }
    const ok = await verifyParentalPin(pinInput);
    if (!ok) { setPinError('PIN incorreto'); return; }
    if (pinAction === 'unblock_adult') {
      await setAdultBlocked(false);
      setPinModalVisible(false);
      refresh();
      if (pendingAdultCategoryId) selectCategory(pendingAdultCategoryId);
      setPendingAdultCategoryId(null);
    } else {
      setNewPinStep(true);
      setPinInput('');
      setPinError('');
    }
  }

  // ── Hooks must come before any early return ──────────────────────────
  // Scroll FlatList/SectionList to keep focused item visible on TV D-Pad navigation
  const scrollToFlatIndex = useCallback((idx: number) => {
    if (!IS_TV) return;
    try {
      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.4 });
    } catch {}
  }, []);

  const scrollToSectionItem = useCallback((sectionIndex: number, itemIndex: number) => {
    if (!IS_TV) return;
    try {
      sectionListRef.current?.scrollToLocation({ sectionIndex, itemIndex, animated: false, viewPosition: 0.4 });
    } catch {}
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Carregando canais...</Text>
      </View>
    );
  }

  const allCats = [
    { category_id: 'all', category_name: 'Todos' },
    ...categories,
  ];

  const renderCategoryButton = (cat: { category_id: string; category_name: string }) => {
    const isActive = cat.category_id === 'all'
      ? selectedCategory === 'all'
      : selectedCategory === cat.category_id;
    return (
      <TVFocusable
        key={cat.category_id}
        style={[styles.chip, IS_TV && styles.chipTV, isActive && styles.chipActive]}
        focusedStyle={{ backgroundColor: 'rgba(229,0,0,0.8)', borderColor: '#fff', borderWidth: 3 }}
        onPress={() => {
          if (cat.category_id !== 'all' && isAdultCategory(cat.category_name) && filterState.adultBlocked) {
            setPendingAdultCategoryId(cat.category_id);
            openPinModal('unblock_adult');
            return;
          }
          selectCategory(cat.category_id);
        }}
      >
        <Text
          style={[styles.chipText, IS_TV && styles.chipTextTV, isActive && styles.chipTextActive]}
          numberOfLines={IS_TV ? 2 : 1}
        >
          {cat.category_name}{cat.category_id !== 'all' && isAdultCategory(cat.category_name) && filterState.adultBlocked ? '  🔒' : ''}
        </Text>
      </TVFocusable>
    );
  };

  const renderChannelItem = (item: NumberedChannel, index?: number, sectionIndex?: number) => {
    const listings = epgByStream[item.primaryStreamId] || [];
    const epgReady = Object.prototype.hasOwnProperty.call(epgByStream, item.primaryStreamId);
    const now = Date.now() / 1000;
    const program = listings.find(value => value.start_timestamp <= now && value.stop_timestamp >= now) || listings[0];
    return (
    <TVFocusable
      key={`${item.categoryId}::${item.baseName}`}
      style={({ pressed }: any) => [styles.channelRow, pressed && styles.channelRowPressed]}
      onPress={() => handlePlay(item)}
      onLongPress={() => {
        if (!IS_TV) {
          setSelectedChannel(item);
          setChannelOptionsModal(true);
        }
      }}
      onFocus={() => {
        loadChannelEpg(item);
        if (index !== undefined && sectionIndex !== undefined) {
          scrollToSectionItem(sectionIndex, index);
        } else if (index !== undefined) {
          scrollToFlatIndex(index);
        }
      }}
      delayLongPress={500}
      hasTVPreferredFocus={IS_TV && index === 0 && (sectionIndex === undefined || sectionIndex === 0)}
      overlayBorderRadius={10}
      focusedStyle={{
        backgroundColor: 'rgba(229,0,0,0.82)',
        borderColor: '#FF0000',
        borderWidth: 5,
        shadowColor: '#FF0000',
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 40,
      }}
    >
      <View style={styles.channelNumber}>
        <Text style={styles.channelNumberText}>{item.channelNumber}</Text>
      </View>
      <View style={styles.channelIcon}>
        {item.icon ? (
          <Image source={{ uri: item.icon }} style={styles.channelImg} contentFit="contain" />
        ) : (
          <Ionicons name="tv" size={22} color={Colors.primary} />
        )}
      </View>
      <View style={styles.channelInfo}>
        <Text style={styles.channelName} numberOfLines={1}>{item.baseName}</Text>
        <Text style={styles.channelProgram} numberOfLines={1}>
          {program ? `Agora: ${program.title || 'Programação ao vivo'}` : epgReady ? 'Programação indisponível' : 'Carregando programação…'}
        </Text>
        <View style={styles.qualityRow}>
          {item.qualities.slice(0, 3).map(q => (
            <View key={q.label} style={styles.qualityBadge}>
              <Text style={styles.qualityBadgeText}>{q.label}</Text>
            </View>
          ))}
        </View>
      </View>
      <Ionicons name="play-circle" size={28} color={Colors.primary} />
    </TVFocusable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>AO VIVO</Text>
        </View>
        <Text style={styles.headerTitle}>TV ao Vivo</Text>
        <Text style={styles.countText}>{groupedChannels.length} canais</Text>
        {!IS_TV && (
          <Pressable
            style={[styles.groupToggle, showGroups && styles.groupToggleActive]}
            onPress={() => setShowGroups(v => !v)}
          >
            <MaterialIcons name="category" size={16} color={showGroups ? '#fff' : Colors.textMuted} />
          </Pressable>
        )}
        <Pressable style={styles.settingsBtn} onPress={() => openPinModal('change_pin')} hitSlop={8}>
          <Ionicons name="settings-outline" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Search */}
      {!IS_TV && (
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar canal..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.contentArea}>
        {/* On TV the provider groups stay in a persistent left sidebar. */}
        {IS_TV ? (
          <View style={styles.categorySidebar}>
            <Text style={styles.categorySidebarTitle}>GRUPOS DE CANAIS</Text>
            <ScrollView
              ref={catScrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.categoryContentTV}
            >
              {allCats.map(renderCategoryButton)}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.categoryBar}>
            <ScrollView
              ref={catScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryContent}
            >
              {allCats.map(renderCategoryButton)}
            </ScrollView>
          </View>
        )}

        {/* Channel list — grouped sections or flat */}
        <View style={styles.channelListArea}>
          {showGroups && sections.length > 0 ? (
            <SectionList
              ref={sectionListRef}
              style={styles.channelList}
              sections={sections}
              keyExtractor={item => `${item.categoryId}::${item.baseName}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              stickySectionHeadersEnabled
              removeClippedSubviews={IS_TV}
              scrollEnabled={!IS_TV}
              windowSize={IS_TV ? 9 : 10}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionDot} />
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionCount}>{section.data.length}</Text>
                </View>
              )}
              renderItem={({ item, index, section }) => {
                const sectionIndex = sections.findIndex(s => s.title === section.title);
                return renderChannelItem(item, index, sectionIndex);
              }}
              ListEmptyComponent={<EmptyChannels />}
              initialNumToRender={IS_TV ? 16 : 20}
              maxToRenderPerBatch={IS_TV ? 12 : 20}
              onScrollToIndexFailed={() => {}}
            />
          ) : (
            <FlatList
              ref={flatListRef}
              style={styles.channelList}
              data={groupedChannels}
              keyExtractor={item => `${item.categoryId}::${item.baseName}`}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={IS_TV}
              scrollEnabled={!IS_TV}
              windowSize={IS_TV ? 9 : 10}
              renderItem={({ item, index }) => renderChannelItem(item, index)}
              ListEmptyComponent={<EmptyChannels />}
              initialNumToRender={IS_TV ? 16 : 20}
              maxToRenderPerBatch={IS_TV ? 12 : 20}
              onScrollToIndexFailed={() => {}}
            />
          )}
        </View>
      </View>

      {/* Channel Options Modal */}
      <Modal visible={channelOptionsModal} transparent animationType="fade" onRequestClose={() => setChannelOptionsModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChannelOptionsModal(false)}>
          <View style={styles.optionsSheet}>
            <View style={styles.optionsHandle} />
            {selectedChannel && (
              <>
                <View style={styles.optionsChannelHeader}>
                  {selectedChannel.icon ? (
                    <Image source={{ uri: selectedChannel.icon }} style={styles.optionsChannelIcon} contentFit="contain" />
                  ) : (
                    <View style={[styles.optionsChannelIcon, { backgroundColor: Colors.bgCardElevated, alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name="tv" size={22} color={Colors.primary} />
                    </View>
                  )}
                  <Text style={styles.optionsChannelName} numberOfLines={1}>{selectedChannel.baseName}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 16, marginBottom: 4 }} />
                <TVFocusable style={styles.optionsRow} onPress={() => { setChannelOptionsModal(false); handlePlay(selectedChannel); }}>
                  <Ionicons name="play-circle-outline" size={22} color={Colors.primary} />
                  <Text style={styles.optionsRowText}>Assistir canal</Text>
                </TVFocusable>
                <TVFocusable style={styles.optionsRow} onPress={async () => {
                  setChannelOptionsModal(false);
                  await hideChannelByKey(selectedChannel.baseName, selectedChannel.categoryId);
                }}>
                  <Ionicons name="eye-off-outline" size={22} color={Colors.error} />
                  <Text style={[styles.optionsRowText, { color: Colors.error }]}>Remover da lista</Text>
                </TVFocusable>
              </>
            )}
            <TVFocusable style={[styles.optionsRow, { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', marginTop: 4, justifyContent: 'center' }]}
              onPress={() => setChannelOptionsModal(false)}>
              <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' }}>Cancelar</Text>
            </TVFocusable>
          </View>
        </Pressable>
      </Modal>

      {/* PIN Modal */}
      <Modal visible={pinModalVisible} transparent animationType="fade" onRequestClose={() => setPinModalVisible(false)}>
        <View style={styles.pinBackdrop}>
          <View style={styles.pinSheet}>
            <Text style={styles.pinTitle}>{newPinStep ? 'Novo PIN' : 'Controle Parental'}</Text>
            <Text style={styles.pinSub}>{newPinStep ? 'Digite o novo PIN (4 dígitos)' : 'Digite o PIN para continuar'}</Text>
            <View style={styles.pinDots}>
              {[0,1,2,3].map(i => (
                <View key={i} style={[styles.pinDot, (newPinStep ? newPin : pinInput).length > i && styles.pinDotFilled]} />
              ))}
            </View>
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            <View style={styles.keypad}>
              {[['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']].map((row, ri) => (
                <View key={ri} style={styles.keypadRow}>
                  {row.map((key, ki) => (
                    <TVFocusable key={ki} style={[styles.keypadBtn, !key && { backgroundColor: 'transparent', borderColor: 'transparent' }]}
                      onPress={() => {
                        if (!key) return;
                        const cur = newPinStep ? newPin : pinInput;
                        if (key === '⌫') {
                          newPinStep ? setNewPin(newPin.slice(0,-1)) : setPinInput(pinInput.slice(0,-1));
                          setPinError('');
                        } else if (cur.length < 4) {
                          const next = cur + key;
                          newPinStep ? setNewPin(next) : setPinInput(next);
                          setPinError('');
                        }
                      }}>
                      {key !== '' && <Text style={styles.keypadText}>{key}</Text>}
                    </TVFocusable>
                  ))}
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TVFocusable style={styles.pinCancelBtn} focusedStyle={{ borderColor: '#E50000', borderWidth: 2, borderRadius: 10 }} onPress={() => setPinModalVisible(false)}>
                <Text style={{ color: Colors.textSecondary, fontWeight: '600' }}>Cancelar</Text>
              </TVFocusable>
              <TVFocusable style={[styles.pinConfirmBtn, (newPinStep ? newPin : pinInput).length < 4 && { opacity: 0.4 }]}
                focusedStyle={{ shadowColor: '#E50000', shadowOpacity: 0.9, shadowRadius: 12, elevation: 16 }}
                onPress={handlePinSubmit}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Confirmar</Text>
              </TVFocusable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EmptyChannels() {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <MaterialIcons name="live-tv" size={52} color={Colors.textMuted} />
      <Text style={{ color: Colors.textSecondary, fontSize: 16, fontWeight: '600', marginTop: 12 }}>Nenhum canal encontrado</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: IS_TV ? F.lg : 16, fontWeight: '700', flex: 1 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(229,0,0,0.15)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary, marginRight: 4 },
  liveText: { color: Colors.primary, fontSize: 9, fontWeight: '700' },
  countText: { color: Colors.textMuted, fontSize: 11 },
  groupToggle: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(8,8,8,0.30)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  groupToggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  settingsBtn: { padding: 4 },
  loadingText: { color: Colors.textSecondary, marginTop: 12, fontSize: 14 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,5,5,0.34)',
    marginHorizontal: 14,
    marginVertical: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 13 },
  contentArea: { flex: 1, minHeight: 0, flexDirection: IS_TV ? 'row' : 'column' },
  categoryBar: { height: 44 },
  categoryContent: { paddingHorizontal: 14, alignItems: 'center', gap: 6 },
  categorySidebar: {
    width: 290,
    backgroundColor: 'transparent',
    paddingTop: 14,
  },
  categorySidebarTitle: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  categoryContentTV: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'transparent', borderWidth: 0,
  },
  chipTV: {
    width: '100%',
    minHeight: 58,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
  chipTextTV: { fontSize: 17, fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  channelListArea: { flex: 1, minWidth: 0, minHeight: 0 },
  channelList: { flex: 1 },
  listContent: { paddingHorizontal: 10, paddingBottom: 20, paddingTop: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 0,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 },
  sectionCount: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(229,0,0,0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 10,
    marginBottom: 6,
    padding: 10,
    borderWidth: 0,
    gap: 10,
  },
  channelRowPressed: { opacity: 0.75 },
  channelNumber: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: 'rgba(229,0,0,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)',
  },
  channelNumberText: { color: Colors.primary, fontSize: 11, fontWeight: '800' },
  channelIcon: {
    width: 46, height: 46, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  channelImg: { width: 46, height: 46 },
  channelInfo: { flex: 1 },
  channelName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  channelProgram: { color: '#9edfff', fontSize: 10, fontWeight: '600', marginBottom: 4 },
  qualityRow: { flexDirection: 'row', gap: 4 },
  qualityBadge: {
    backgroundColor: 'rgba(229,0,0,0.15)', borderRadius: 3,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.3)',
  },
  qualityBadgeText: { color: Colors.primary, fontSize: 8, fontWeight: '700' },
  // modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  optionsSheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 28, borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(229,0,0,0.2)',
  },
  optionsHandle: { width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 16 },
  optionsChannelHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  optionsChannelIcon: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
  optionsChannelName: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  optionsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 14 },
  optionsRowText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  pinBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  pinSheet: {
    backgroundColor: '#141414', borderRadius: 20, padding: 24,
    width: '100%', maxWidth: 360, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(229,0,0,0.25)',
  },
  pinTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  pinSub: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 20 },
  pinDots: { flexDirection: 'row', gap: 14, marginBottom: 12 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  pinDotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pinError: { color: Colors.error, fontSize: 12, marginBottom: 8 },
  keypad: { width: '100%', gap: 8, marginBottom: 20 },
  keypadRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  keypadBtn: {
    width: 72, height: 54, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  keypadText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pinCancelBtn: {
    flex: 1, height: 46, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  pinConfirmBtn: {
    flex: 1, height: 46, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
});
