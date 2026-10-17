import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Modal, NativeModules, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import TVFocusable from '@/components/ui/TVFocusable';

const KEYS = [
  'A', 'B', 'C', 'D', 'E', 'F',
  'G', 'H', 'I', 'J', 'K', 'L',
  'M', 'N', 'O', 'P', 'Q', 'R',
  'S', 'T', 'U', 'V', 'W', 'X',
  'Y', 'Z', 'Ç', 'Á', 'Ã', 'É',
  'Í', 'Ó', 'Õ', 'Ú', '0', '1',
  '2', '3', '4', '5', '6', '7',
  '8', '9', '-', '?', '!', '.',
];
const KEY_COLUMNS = 6;
const KEY_ROWS = Array.from({ length: KEYS.length / KEY_COLUMNS }, (_, row) =>
  KEYS.slice(row * KEY_COLUMNS, (row + 1) * KEY_COLUMNS)
);

interface TVCatalogSearchProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Identifies the trigger for explicit webOS focus routing. */
  testID?: string;
  /** Label of the keyboard confirmation button. */
  submitLabel?: string;
  /** Use only where entering the catalog should land directly on search. */
  hasTVPreferredFocus?: boolean;
}

interface KeyboardFocusableProps {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
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
  testID,
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
      testID={testID}
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
export default function TVCatalogSearch({ label, value, onChangeText, testID = 'catalog-search-trigger', submitLabel = 'BUSCAR', hasTVPreferredFocus = false }: TVCatalogSearchProps) {
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef<any>(null);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  // Keep remote movement inside the visual keyboard grid. A flex-wrapped grid
  // can have a different number of keys per row on each TV, which made Right
  // occasionally jump up/down to a nearby button.
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;

    const focusTestId = (testID: string) => {
      document.querySelector<HTMLElement>(`[data-testid="${testID}"]`)?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const id = active?.getAttribute('data-testid') || '';
      const keyMatch = id.match(/^catalog-key-(\d+)$/);
      const actionMatch = id.match(/^catalog-action-(\d+)$/);
      const key = event.key || String(event.keyCode);
      // Back must close the virtual keyboard itself. Without this capture the
      // page-level webOS handler navigates away from the catalog screen.
      const isBack = key === 'Escape' || key === 'BrowserBack' || key === 'Backspace' || event.keyCode === 461;
      if (isBack) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSearch();
        return;
      }
      const direction = key === 'ArrowLeft' || key === '37' ? 'left'
        : key === 'ArrowRight' || key === '39' ? 'right'
        : key === 'ArrowUp' || key === '38' ? 'up'
        : key === 'ArrowDown' || key === '40' ? 'down' : null;
      if (!direction || (!keyMatch && !actionMatch)) return;

      let target: string | null = null;
      if (keyMatch) {
        const index = Number(keyMatch[1]);
        const column = index % KEY_COLUMNS;
        if (direction === 'left' && column > 0) target = `catalog-key-${index - 1}`;
        if (direction === 'right' && column < KEY_COLUMNS - 1) target = `catalog-key-${index + 1}`;
        if (direction === 'up' && index >= KEY_COLUMNS) target = `catalog-key-${index - KEY_COLUMNS}`;
        if (direction === 'down') {
          target = index + KEY_COLUMNS < KEYS.length
            ? `catalog-key-${index + KEY_COLUMNS}`
            : `catalog-action-${[0, 0, 1, 1, 2, 3][column]}`;
        }
      } else if (actionMatch) {
        const index = Number(actionMatch[1]);
        if (direction === 'left' && index > 0) target = `catalog-action-${index - 1}`;
        if (direction === 'right' && index < 3) target = `catalog-action-${index + 1}`;
        if (direction === 'up') target = `catalog-key-${KEYS.length - KEY_COLUMNS + [0, 1, 2, 4][index]}`;
      }

      // At an edge keep focus in place instead of letting the generic page
      // navigator choose a control on a different keyboard row.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (target) focusTestId(target);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible]);

  function openSearch() {
    setDraft(value);
    setVisible(true);
  }

  function closeSearch() {
    setVisible(false);
    if (typeof document !== 'undefined') {
      setTimeout(() => triggerRef.current?.focus?.(), 0);
    }
  }

  // Keep the typed text local while the modal is open. Updating the catalog
  // on every character remounts the list behind this modal on webOS and used
  // to close the keyboard after its first letter.
  function updateDraft(updater: (current: string) => string) {
    setDraft(current => {
      const next = updater(current);
      return next;
    });
  }

  function applySearch() {
    onChangeText(draft.trim());
    closeSearch();
  }

  return (
    <>
      <TVFocusable
        ref={triggerRef}
        style={styles.trigger}
        focusedStyle={styles.triggerFocused}
        overlayBorderRadius={12}
        testID={testID}
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
        onRequestClose={closeSearch}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog} testID="catalog-keyboard-dialog">
            <View style={styles.dialogHeader}>
              <View>
                <Text style={styles.title}>{label}</Text>
                <Text style={styles.help}>Use as setas e OK do controle</Text>
              </View>
              <KeyboardFocusable
                testID="catalog-close"
                style={styles.closeButton}
                onPress={closeSearch}
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
              {KEY_ROWS.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.keyRow}>
                  {row.map((key, columnIndex) => {
                    const index = rowIndex * KEY_COLUMNS + columnIndex;
                    return (
                      <KeyboardFocusable
                        key={key}
                        testID={`catalog-key-${index}`}
                        style={styles.key}
                        hasTVPreferredFocus={index === 0}
                        onPress={() => updateDraft(current => `${current}${key}`)}
                      >
                        <Text style={styles.keyText}>{key}</Text>
                      </KeyboardFocusable>
                    );
                  })}
                </View>
              ))}
            </View>

            <View style={styles.actions}>
              <KeyboardFocusable
                testID="catalog-action-0"
                style={[styles.action, styles.spaceAction]}
                onPress={() => updateDraft(current => `${current} `)}
              >
                <Text style={styles.actionText}>ESPAÇO</Text>
              </KeyboardFocusable>
              <KeyboardFocusable
                testID="catalog-action-1"
                style={styles.action}
                onPress={() => updateDraft(current => current.slice(0, -1))}
              >
                <Ionicons name="backspace-outline" size={24} color="#fff" />
              </KeyboardFocusable>
              <KeyboardFocusable
                testID="catalog-action-2"
                style={styles.action}
                onPress={() => updateDraft(() => '')}
              >
                <Ionicons name="trash-outline" size={23} color="#fff" />
              </KeyboardFocusable>
              <KeyboardFocusable
                testID="catalog-action-3"
                style={[styles.action, styles.searchAction]}
                onPress={applySearch}
              >
                <Ionicons name="search" size={24} color="#000" />
                <Text style={styles.searchActionText}>{submitLabel}</Text>
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
    height: 48,
    marginHorizontal: 14,
    marginVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(7,7,7,0.26)',
    borderWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  triggerFocused: { borderColor: Colors.primary, borderWidth: 3 },
  triggerText: { flex: 1, color: Colors.textSecondary, fontSize: 16, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 780, backgroundColor: 'rgba(12,8,18,0.78)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(229,0,0,0.55)', padding: 16 },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontSize: 21, fontWeight: '800' },
  help: { color: 'rgba(255,255,255,0.68)', fontSize: 12, marginTop: 2 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  closeButtonFocused: { borderColor: Colors.primary, borderWidth: 3 },
  queryBox: { height: 46, borderRadius: 10, paddingHorizontal: 13, backgroundColor: 'rgba(0,0,0,0.20)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  queryText: { color: '#fff', fontSize: 17, fontWeight: '600', flex: 1 },
  queryPlaceholder: { color: Colors.textMuted, fontWeight: '400' },
  keyGrid: { gap: 6, alignItems: 'center' },
  keyRow: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  key: { width: 52, height: 38, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' },
  keyFocused: { borderColor: Colors.primary, borderWidth: 3, backgroundColor: '#173a52' },
  keyText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center' },
  action: { minWidth: 54, height: 42, borderRadius: 8, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  actionFocused: { borderColor: Colors.primary, borderWidth: 3, backgroundColor: '#173a52' },
  spaceAction: { minWidth: 135 },
  actionText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  searchAction: { minWidth: 125, backgroundColor: Colors.primary },
  searchActionFocused: { borderColor: '#fff', borderWidth: 3, backgroundColor: '#7acbff' },
  searchActionText: { color: '#000', fontSize: 13, fontWeight: '900' },
});
