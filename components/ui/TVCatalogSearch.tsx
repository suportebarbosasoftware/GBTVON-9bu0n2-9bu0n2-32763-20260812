import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Modal, NativeModules, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import TVFocusable from '@/components/ui/TVFocusable';

const KEYS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G',
  'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'P', 'Q', 'R', 'S', 'T', 'U',
  'V', 'W', 'X', 'Y', 'Z', '0', '1',
  '2', '3', '4', '5', '6', '7', '8', '9',
];

interface TVCatalogSearchProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Use only where entering the catalog should land directly on search. */
  hasTVPreferredFocus?: boolean;
}

interface KeyboardFocusableProps {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}

const tvDeviceInfo = NativeModules.TVDeviceInfo;

/**
 * The React Native Modal used by this keyboard is rendered in a separate
 * Android window, outside MainActivity's global TV focus overlay. Attach a
 * native overlay directly to this one view so it follows Android's real focus
 * in the modal, without changing the app-wide TV focus implementation.
 */
function KeyboardFocusable({
  children,
  style,
  onPress,
  hasTVPreferredFocus = false,
}: KeyboardFocusableProps) {
  const focusableRef = useRef<any>(null);
  const attachedRef = useRef(false);

  const attachModalFocus = useCallback(() => {
    if (attachedRef.current) return;
    const viewTag = findNodeHandle(focusableRef.current);
    if (typeof viewTag !== 'number') return;
    attachedRef.current = true;
    try {
      tvDeviceInfo?.attachModalFocusIndicator?.(viewTag);
    } catch {
      // The keyboard remains fully usable on phones and on builds without
      // the Android TV helper; only its TV-only decoration is skipped.
    }
  }, []);

  return (
    <TVFocusable
      ref={focusableRef}
      style={style}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onLayout={attachModalFocus}
      onPress={onPress}
    >
      {children}
    </TVFocusable>
  );
}

/**
 * Remote-only catalog search. Android TV keyboards are not present on every
 * box and a focused native TextInput can crash on older TV firmware, so this
 * component deliberately contains no TextInput.
 */
export default function TVCatalogSearch({ label, value, onChangeText, hasTVPreferredFocus = false }: TVCatalogSearchProps) {
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  function openSearch() {
    setDraft(value);
    setVisible(true);
  }

  function applySearch() {
    onChangeText(draft.trim());
    setVisible(false);
  }

  return (
    <>
      <TVFocusable
        style={styles.trigger}
        focusedStyle={styles.triggerFocused}
        overlayBorderRadius={12}
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={openSearch}
      >
        <Ionicons name="search" size={22} color={Colors.textSecondary} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {value || label}
        </Text>
        {value ? <Ionicons name="create-outline" size={19} color={Colors.primary} /> : null}
      </TVFocusable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <View style={styles.dialogHeader}>
              <View>
                <Text style={styles.title}>{label}</Text>
                <Text style={styles.help}>Use as setas e OK do controle</Text>
              </View>
              <KeyboardFocusable
                style={styles.closeButton}
                onPress={() => setVisible(false)}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </KeyboardFocusable>
            </View>

            <View style={styles.queryBox}>
              <Ionicons name="search" size={25} color={Colors.primary} />
              <Text style={[styles.queryText, !draft && styles.queryPlaceholder]} numberOfLines={1}>
                {draft || 'Digite o nome para pesquisar'}
              </Text>
            </View>

            <View style={styles.keyGrid}>
              {KEYS.map((key, index) => (
                <KeyboardFocusable
                  key={key}
                  style={styles.key}
                  hasTVPreferredFocus={index === 0}
                  onPress={() => setDraft(current => `${current}${key}`)}
                >
                  <Text style={styles.keyText}>{key}</Text>
                </KeyboardFocusable>
              ))}
            </View>

            <View style={styles.actions}>
              <KeyboardFocusable
                style={[styles.action, styles.spaceAction]}
                onPress={() => setDraft(current => `${current} `)}
              >
                <Text style={styles.actionText}>ESPAÇO</Text>
              </KeyboardFocusable>
              <KeyboardFocusable
                style={styles.action}
                onPress={() => setDraft(current => current.slice(0, -1))}
              >
                <Ionicons name="backspace-outline" size={24} color="#fff" />
              </KeyboardFocusable>
              <KeyboardFocusable
                style={styles.action}
                onPress={() => setDraft('')}
              >
                <Ionicons name="trash-outline" size={23} color="#fff" />
              </KeyboardFocusable>
              <KeyboardFocusable
                style={[styles.action, styles.searchAction]}
                onPress={applySearch}
              >
                <Ionicons name="search" size={24} color="#000" />
                <Text style={styles.searchActionText}>BUSCAR</Text>
              </KeyboardFocusable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    height: 54,
    marginHorizontal: 14,
    marginVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  triggerFocused: { borderColor: Colors.primary, borderWidth: 3 },
  triggerText: { flex: 1, color: Colors.textSecondary, fontSize: 16, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 1000, backgroundColor: '#121212', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(46,168,255,0.4)', padding: 24 },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { color: '#fff', fontSize: 25, fontWeight: '800' },
  help: { color: Colors.textMuted, fontSize: 14, marginTop: 4 },
  closeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292929' },
  closeButtonFocused: { borderColor: Colors.primary, borderWidth: 3 },
  queryBox: { height: 58, borderRadius: 10, paddingHorizontal: 16, backgroundColor: '#090909', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  queryText: { color: '#fff', fontSize: 20, fontWeight: '600', flex: 1 },
  queryPlaceholder: { color: Colors.textMuted, fontWeight: '400' },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'center' },
  key: { width: 62, height: 48, borderRadius: 9, backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center' },
  keyFocused: { borderColor: Colors.primary, borderWidth: 3, backgroundColor: '#173a52' },
  keyText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, justifyContent: 'center' },
  action: { minWidth: 64, height: 48, borderRadius: 9, paddingHorizontal: 15, backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  actionFocused: { borderColor: Colors.primary, borderWidth: 3, backgroundColor: '#173a52' },
  spaceAction: { minWidth: 160 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  searchAction: { minWidth: 150, backgroundColor: Colors.primary },
  searchActionFocused: { borderColor: '#fff', borderWidth: 3, backgroundColor: '#7acbff' },
  searchActionText: { color: '#000', fontSize: 13, fontWeight: '900' },
});
