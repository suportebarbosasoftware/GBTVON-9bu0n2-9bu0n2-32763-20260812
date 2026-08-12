/**
 * GBTVON — Main Layout
 * Side navigation (vertical, right panel) for landscape mode.
 * Works on phones, TV Box, Android TV, Fire TV.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, BackHandler } from 'react-native';
import TVFocusable from '@/components/ui/TVFocusable';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { IS_TV, TV } from '@/hooks/useTV';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'expo-router';
import NotificationBanner from '@/components/ui/NotificationBanner';
import LiveTVScreen from './index';
import MoviesScreen from './movies';
import SeriesScreen from './series';
import ProfileScreen from './profile';

type TabId = 'live' | 'movies' | 'series' | 'profile';

/** Individual sidebar tab — tracks own focus state so activeIndicator follows D-Pad */
function SidebarTab({
  tab,
  active,
  onFocus,
  onPress,
}: {
  tab: { id: TabId; label: string; icon: string; activeIcon: string };
  active: boolean;
  onFocus: () => void;
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const showIndicator = active || isFocused;
  return (
    <TVFocusable
      style={({ pressed }: any) => [
        styles.navItem,
        active && styles.navItemActive,
        IS_TV && styles.navItemTV,
        pressed && !active && { opacity: 0.7 },
      ]}
      focusedStyle={{
        backgroundColor: 'rgba(229,0,0,0.82)',
        borderWidth: 4,
        borderColor: '#E50000',
        shadowColor: '#E50000',
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 20,
      }}
      focusScale={IS_TV ? 1.07 : 1.0}
      overlayBorderRadius={12}
      onFocus={() => { setIsFocused(true); onFocus(); }}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
    >
      {showIndicator && <View style={styles.activeIndicator} />}
      <Ionicons
        name={(active || isFocused ? tab.activeIcon : tab.icon) as any}
        size={IS_TV ? TV.iconSize.sm : 22}
        color={active || isFocused ? Colors.primary : 'rgba(255,255,255,0.45)'}
      />
      <Text
        style={[
          styles.navLabel,
          (active || isFocused) && styles.navLabelActive,
          IS_TV && { fontSize: 11 },
        ]}
        numberOfLines={1}
      >
        {tab.label}
      </Text>
    </TVFocusable>
  );
}

const TABS: { id: TabId; label: string; icon: string; activeIcon: string }[] = [
  { id: 'live',    label: 'TV ao Vivo', icon: 'tv-outline',           activeIcon: 'tv' },
  { id: 'movies',  label: 'Filmes',     icon: 'film-outline',          activeIcon: 'film' },
  { id: 'series',  label: 'Séries',     icon: 'videocam-outline',      activeIcon: 'videocam' },
  { id: 'profile', label: 'Perfil',     icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

const SIDEBAR_W = IS_TV ? 90 : 72;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const { isAuthenticated, activationStatus, blockReasonDetail, devicePrice } = useAuth();
  const router = useRouter();
  const lastStatusRef = useRef(activationStatus);

  // Android TV back button — navigate tabs or exit app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // If not on live tab, go back to live
      if (activeTab !== 'live') {
        setActiveTab('live');
        return true;
      }
      // On live tab: let Android handle (minimize/exit)
      return false;
    });
    return () => sub.remove();
  }, [activeTab]);

  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = activationStatus;
    if (activationStatus === null) return;
    if (
      prev === 'activated' &&
      (activationStatus === 'blocked_manual' || activationStatus === 'expired')
    ) {
      router.replace({ 
        pathname: '/blocked', 
        params: { 
          reason: activationStatus,
          blockDetail: blockReasonDetail || '',
          price: devicePrice ? String(devicePrice) : '',
        } 
      } as any);
    }
    if (!isAuthenticated && prev === 'activated') {
      router.replace('/login' as any);
    }
  }, [activationStatus, isAuthenticated]);

  return (
    <View style={styles.root}>
      {/* ── Main Content Area ──────────────────────────────────────── */}
      <View style={styles.content}>
        {activeTab === 'live'    && <LiveTVScreen />}
        {activeTab === 'movies'  && <MoviesScreen />}
        {activeTab === 'series'  && <SeriesScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
        <NotificationBanner />
      </View>

      {/* ── Left Side Navigation ──────────────────────────────────── */}
      <View style={[
        styles.sidebar,
        {
          width: SIDEBAR_W,
          paddingTop: Math.max(insets.top + 8, IS_TV ? 20 : 12),
          paddingBottom: Math.max(insets.bottom + 8, IS_TV ? 20 : 12),
        },
      ]}>
        {/* Logo at top */}
        <View style={styles.sidebarLogo}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>GB</Text>
          </View>
        </View>

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Nav items */}
        <View style={styles.navItems}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <SidebarTab
                key={tab.id}
                tab={tab}
                active={active}
                onFocus={() => setActiveTab(tab.id)}
                onPress={() => setActiveTab(tab.id)}
              />
            );
          })}
        </View>

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Bottom live indicator */}
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>LIVE</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row-reverse',
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  sidebar: {
    backgroundColor: '#0a0a0a',
    borderRightWidth: 1,
    borderRightColor: 'rgba(229,0,0,0.18)',
    alignItems: 'center',
  },
  sidebarLogo: {
    alignItems: 'center',
    marginBottom: 8,
  },
  logoCircle: {
    width: IS_TV ? 48 : 38,
    height: IS_TV ? 48 : 38,
    borderRadius: IS_TV ? 14 : 11,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#fff',
    fontSize: IS_TV ? 16 : 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  navItems: {
    width: '100%',
    alignItems: 'center',
    gap: IS_TV ? 6 : 4,
    paddingHorizontal: IS_TV ? 6 : 4,
  },
  navItem: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: IS_TV ? 12 : 10,
    borderRadius: 12,
    gap: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  navItemTV: {
    paddingVertical: 16,
    borderRadius: 14,
  },
  navItemActive: {
    backgroundColor: 'rgba(229,0,0,0.12)',
  },
  activeIndicator: {
    position: 'absolute',
    left: 0,
    top: '20%',
    width: 3,
    height: '60%',
    backgroundColor: Colors.primary,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  navLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  liveIndicator: {
    alignItems: 'center',
    gap: 3,
    marginTop: 8,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  liveLabel: {
    color: Colors.primary,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
