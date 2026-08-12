/**
 * NotificationBanner — GBTVON
 * Displays admin notifications as dismissible banners at the top of the screen.
 * Automatically shown in all tab screens when new notifications arrive.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Colors, BorderRadius } from '@/constants/theme';
import { IS_TV, TV } from '@/hooks/useTV';

export default function NotificationBanner() {
  const { pendingNotifications, markNotificationsRead } = useAuth();
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const [visible, setVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const notifications = pendingNotifications;

  useEffect(() => {
    if (notifications.length > 0) {
      setCurrentIndex(0);
      setVisible(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      hide();
    }
  }, [notifications.length]);

  function hide() {
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setVisible(false));
    markNotificationsRead();
  }

  function next() {
    if (currentIndex < notifications.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      hide();
    }
  }

  if (!visible || notifications.length === 0) return null;

  const notif = notifications[currentIndex];
  if (!notif) return null;

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.banner}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications" size={IS_TV ? TV.iconSize.sm : 18} color="#fff" />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, IS_TV && { fontSize: TV.fontSize.md }]} numberOfLines={1}>
            {notif.title}
          </Text>
          <ScrollView style={styles.msgScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.message, IS_TV && { fontSize: TV.fontSize.sm }]}>
              {notif.message}
            </Text>
          </ScrollView>
          {notifications.length > 1 && (
            <Text style={styles.counter}>
              {currentIndex + 1}/{notifications.length}
            </Text>
          )}
        </View>
        <Pressable onPress={next} hitSlop={12} style={styles.closeBtn}>
          <Ionicons
            name={currentIndex < notifications.length - 1 ? 'chevron-forward' : 'close'}
            size={IS_TV ? TV.iconSize.sm : 20}
            color="rgba(255,255,255,0.7)"
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: IS_TV ? 32 : 12,
    paddingTop: IS_TV ? 16 : 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a0a00',
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    padding: IS_TV ? 18 : 12,
    gap: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  iconWrap: {
    width: IS_TV ? 44 : 36,
    height: IS_TV ? 44 : 36,
    borderRadius: IS_TV ? 22 : 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
  },
  msgScroll: { maxHeight: 52 },
  message: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    lineHeight: 17,
  },
  counter: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
  },
});
