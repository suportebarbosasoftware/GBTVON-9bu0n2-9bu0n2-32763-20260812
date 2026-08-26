import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/hooks/useAuth';
import { isSetupDone } from '@/services/channelSetupService';
import { Colors } from '@/constants/theme';

export default function SplashScreen() {
  const { isAuthenticated, isLoading, activationStatus } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 24 }} />
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

  if (!checked) {
    return (
      <View style={styles.splash}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (needsSetup) return <Redirect href="/channel-setup" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 28,
  },
});
