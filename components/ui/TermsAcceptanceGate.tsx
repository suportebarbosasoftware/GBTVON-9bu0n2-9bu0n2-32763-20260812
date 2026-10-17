import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import TVFocusable from '@/components/ui/TVFocusable';

const TERMS_VERSION = 'v1';

/** Blocks catalog access until the current user accepts the media-use terms. */
export default function TermsAcceptanceGate() {
  const { isAuthenticated, userEmail, macAddress, logout } = useAuth();
  const [checked, setChecked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const identity = (userEmail || macAddress || 'dispositivo').replace(/[^a-z0-9_-]/gi, '_');
  const storageKey = `gbtvon_media_terms_${TERMS_VERSION}_${identity}`;

  useEffect(() => {
    let active = true;
    if (!isAuthenticated) {
      setChecked(false);
      setAccepted(false);
      return;
    }
    setChecked(false);
    void AsyncStorage.getItem(storageKey).then(value => {
      if (!active) return;
      setAccepted(value === 'accepted');
      setChecked(true);
    }).catch(() => {
      if (active) setChecked(true);
    });
    return () => { active = false; };
  }, [isAuthenticated, storageKey]);

  useEffect(() => {
    if (!isAuthenticated || !checked || accepted || typeof document === 'undefined') return;
    const timer = setTimeout(() => document.querySelector<HTMLElement>('[data-testid="terms-accept"]')?.focus(), 120);
    return () => clearTimeout(timer);
  }, [accepted, checked, isAuthenticated]);

  // React Native Web renders Modal in its own layer on webOS. Some LG
  // firmware does not route D-pad focus from the page to that layer, so the
  // terms dialog owns its small, deterministic remote navigation.
  useEffect(() => {
    if (!isAuthenticated || !checked || accepted || typeof document === 'undefined') return;
    const focus = (testID: string) => document.querySelector<HTMLElement>(`[data-testid="${testID}"]`)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      const keyCode = event.keyCode;
      const isLeft = key === 'ArrowLeft' || keyCode === 37;
      const isRight = key === 'ArrowRight' || keyCode === 39;
      const isUp = key === 'ArrowUp' || keyCode === 38;
      const isDown = key === 'ArrowDown' || keyCode === 40;
      const isOK = key === 'Enter' || key === 'Select' || keyCode === 13;
      const isBack = key === 'Escape' || key === 'BrowserBack' || key === 'Backspace' || keyCode === 461;
      if (!isLeft && !isRight && !isUp && !isDown && !isOK && !isBack) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isBack) return;
      if (isUp || isDown) {
        document.querySelector<HTMLElement>('[data-testid="terms-content"]')?.scrollBy({ top: isUp ? -180 : 180, behavior: 'smooth' });
        return;
      }
      if (isLeft) { focus('terms-decline'); return; }
      if (isRight) { focus('terms-accept'); return; }
      const active = document.activeElement?.getAttribute('data-testid');
      if (active === 'terms-decline') void decline();
      else void accept();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [accepted, checked, isAuthenticated, storageKey]);

  if (!isAuthenticated || (checked && accepted)) return null;

  async function accept() {
    await AsyncStorage.setItem(storageKey, 'accepted');
    setAccepted(true);
  }

  async function decline() {
    await logout();
    router.replace('/login' as any);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop} testID="terms-gate">
        <View style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.icon}><Ionicons name="shield-checkmark-outline" size={30} color="#00c853" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Termo de uso e responsabilidade</Text>
              <Text style={styles.subtitle}>Leia e aceite para continuar</Text>
            </View>
          </View>

          {!checked ? <View style={styles.loading}><ActivityIndicator color="#00c853" /><Text style={styles.loadingText}>Carregando termo...</Text></View> : (
            <ScrollView testID="terms-content" style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator>
              <Text style={styles.lead}>O GBTVON é exclusivamente um reprodutor de mídia.</Text>
              <Text style={styles.paragraph}>O aplicativo não cria, hospeda, transmite, vende, revende ou controla listas, canais, filmes, séries ou qualquer conteúdo de terceiros.</Text>
              <Text style={styles.paragraph}>Cada usuário é o único responsável por utilizar apenas conteúdo próprio, público ou para o qual possua autorização, licença ou outro direito válido de acesso. O usuário deve respeitar direitos autorais, classificação indicativa, privacidade e as leis aplicáveis.</Text>
              <Text style={styles.paragraph}>É proibido usar o aplicativo para acessar, compartilhar ou divulgar conteúdo sem autorização. O usuário também é responsável pela lista ou fonte de conteúdo que escolher adicionar ao seu acesso.</Text>
              <Text style={styles.paragraph}>Para ativação, suporte e segurança, o aplicativo pode usar o nome informado e o identificador do dispositivo. Ao aceitar, você declara que leu, compreendeu e concorda com estas condições.</Text>
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TVFocusable testID="terms-decline" style={styles.decline} focusedStyle={styles.declineFocus} onPress={() => void decline()} disabled={!checked}>
              <Text style={styles.declineText}>Não aceito</Text>
            </TVFocusable>
            <TVFocusable testID="terms-accept" style={styles.accept} focusedStyle={styles.acceptFocus} hasTVPreferredFocus onPress={() => void accept()} disabled={!checked}>
              <Ionicons name="checkmark-circle" size={20} color="#000" />
              <Text style={styles.acceptText}>Aceitar e continuar</Text>
            </TVFocusable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 34 },
  dialog: { width: '100%', maxWidth: 980, maxHeight: '90%', backgroundColor: '#131313', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,200,83,0.45)', padding: 26 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  icon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,200,83,0.12)' },
  title: { color: '#fff', fontSize: 27, fontWeight: '900' },
  subtitle: { color: '#a7a7a7', fontSize: 15, marginTop: 3 },
  content: { maxHeight: 340, backgroundColor: '#0b0b0b', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  contentInner: { padding: 18, gap: 12 },
  lead: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 26 },
  paragraph: { color: '#d1d1d1', fontSize: 16, lineHeight: 24 },
  loading: { height: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#aaa', fontSize: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 20 },
  decline: { minWidth: 150, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#555' },
  declineFocus: { borderColor: '#fff', borderWidth: 3 },
  declineText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  accept: { minWidth: 250, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, backgroundColor: '#00c853' },
  acceptFocus: { borderColor: '#fff', borderWidth: 4, shadowColor: '#00c853', shadowOpacity: 0.9, shadowRadius: 15 },
  acceptText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
