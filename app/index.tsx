import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '@/hooks/useAuth';
import { isSetupDone } from '@/services/channelSetupService';

export default function SplashScreen() {
  const { isAuthenticated, isLoading, activationStatus } = useAuth();
  const [introFinished, setIntroFinished] = useState(false);
  const introPlayer = useVideoPlayer(require('@/assets/images/intro.mp4'), player => {
    player.loop = false;
    player.play();
  });

  useEffect(() => {
    const completed = introPlayer.addListener('playToEnd', () => setIntroFinished(true));
    // A malformed media file must never prevent the user from entering the app.
    const failed = introPlayer.addListener('statusChange', ({ status }) => {
      if (status === 'error') setIntroFinished(true);
    });
    const fallback = setTimeout(() => setIntroFinished(true), 20_000);

    return () => {
      completed.remove();
      failed.remove();
      clearTimeout(fallback);
    };
  }, [introPlayer]);

  if (!introFinished || isLoading) {
    return (
      <View style={styles.splash}>
        <VideoView
          player={introPlayer}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // The intro is a short composited animation. TextureView avoids the
          // muted-looking SurfaceView composition seen on some Android TVs.
          surfaceType="textureView"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          pointerEvents="none"
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
    </View>
  );

  if (needsSetup) return <Redirect href="/channel-setup" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#000',
  },
});
