import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { isSetupDone } from '@/services/channelSetupService';

/**
 * webOS does not support expo-video, but its browser can play the bundled
 * opening video directly. Any playback error or unusually slow load falls
 * back to the app so a video problem can never leave the TV on a black screen.
 */
const introVideo = require('@/assets/images/intro.mp4') as string;

function isLgTvBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /web0s|webos|netcast|lg\s*browser/i.test(navigator.userAgent);
}

export default function WebSplashScreen() {
  const { isAuthenticated, isDemoMode, isLoading, activationStatus } = useAuth();
  // A introdução é mantida na TV LG. Em navegadores de computador, alguns
  // bloqueiam a reprodução automática e podem deixar o usuário preso nela.
  const showOpeningVideo = isLgTvBrowser();
  const [introFinished, setIntroFinished] = useState(!showOpeningVideo);

  useEffect(() => {
    if (!showOpeningVideo) return;
    const timer = setTimeout(() => setIntroFinished(true), 20_000);
    return () => clearTimeout(timer);
  }, [showOpeningVideo]);

  if ((showOpeningVideo && !introFinished) || isLoading) {
    return (
      <View style={styles.splash}>
        <video
          autoPlay
          playsInline
          preload="auto"
          src={introVideo}
          onEnded={() => setIntroFinished(true)}
          onError={() => setIntroFinished(true)}
          style={styles.introVideo as any}
        />
      </View>
    );
  }

  if (!isAuthenticated) {
    if (activationStatus === 'expired' || activationStatus === 'blocked_manual') {
      return <Redirect href={{ pathname: '/blocked', params: { reason: activationStatus } }} />;
    }
    return <Redirect href="/login" />;
  }

  // A conta de avaliação LG usa somente o catálogo público embarcado. Ela
  // entra direto na navegação, sem exigir uma lista pessoal de canais.
  if (isDemoMode) return <Redirect href="/(tabs)" />;

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

  if (!checked) return <View style={styles.splash} />;
  return <Redirect href={needsSetup ? '/channel-setup' : '/(tabs)'} />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#000' },
  introVideo: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
});
