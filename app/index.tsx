import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/theme';
import { isSetupDone } from '@/services/channelSetupService';

export default function SplashScreen() {
  const { isAuthenticated, isLoading, activationStatus } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (showSplash || isLoading) {
    return (
      <View style={styles.splash}>
        <Image
          source={{ uri: 'https://cdn-ai.onspace.ai/onspace/files/GEQj7h9Nsh3WdBFtjxD2zQ/IMG_7275.jpeg' }}
          style={styles.splashLogo}
          contentFit="contain"
          transition={400}
        />
        <Text style={styles.splashTitle}>GBTVON</Text>
        <Text style={styles.splashTagline}>Mais que TV, Uma Experiência!</Text>
        <ActivityIndicator color={Colors.primary} size="small" style={{ marginTop: 32 }} />
      </View>
    );
  }

  if (!isAuthenticated) {
    if (activationStatus === 'expired' || activationStatus === 'blocked_manual') {
      return <Redirect href={{ pathname: '/blocked', params: { reason: activationStatus } }} />;
    }
    return <Redirect href="/login" />;
  }

  return <SetupChecker />;
}

function SetupChecker() {
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    isSetupDone().then(done => {
      setNeedsSetup(!done);
      setChecked(true);
    });
  }, []);

  if (!checked) return (
    <View style={styles.splash}>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );

  if (needsSetup) return <Redirect href="/channel-setup" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  splashLogo: {
    width: 180,
    height: 180,
    borderRadius: 32,
    marginBottom: 20,
  },
  splashTitle: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: Colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  splashTagline: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    letterSpacing: 1,
    fontStyle: 'italic',
    marginTop: 6,
  },
});
