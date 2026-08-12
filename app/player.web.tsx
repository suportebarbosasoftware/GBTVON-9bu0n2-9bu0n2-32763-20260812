/**
 * player.web.tsx — Web stub for PlayerScreen
 * react-native-video does not support web.
 * This stub prevents build errors on web platform.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

export default function PlayerScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Player</Text>
      <Text style={styles.msg}>
        A reprodução de vídeo está disponível apenas no aplicativo Android / TV.
      </Text>
      <Pressable style={styles.btn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Voltar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  msg: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn: { backgroundColor: '#E50000', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
