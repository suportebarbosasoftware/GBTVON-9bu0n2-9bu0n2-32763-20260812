/**
 * TVFocusable — GBTVON (v5 — Native Android)
 *
 * Em Android TV / TV Box:
 *   Usa TVFocusableView (componente nativo Kotlin).
 *   O Android é a ÚNICA fonte da verdade para foco.
 *   onNativeFocus / onNativeBlur → isFocused → desenha borda + sombra + escala.
 *   onNativePress → chama onPress original.
 *   Nunca adivinhar foco por estado JS ou TVEventHandler.
 *
 * Em celular / tablet (IS_TV = false):
 *   Pressable padrão, sem anel vermelho.
 *
 * ⚠️  Qualquer Pressable INTERNO que não deve receber foco na TV
 *     deve ter focusable={false} ou ser substituído por View.
 */
import React, { useState, useRef, forwardRef } from 'react';
import {
  Pressable,
  View,
  ViewStyle,
  PressableProps,
  Platform,
  requireNativeComponent,
  StyleSheet,
} from 'react-native';
import { IS_TV } from '@/hooks/useTV';

// ── Native component (Android only) ─────────────────────────────────────────

type NativeTVFocusableProps = {
  focusable?: boolean;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  onNativeFocus?: (e: any) => void;
  onNativeBlur?: (e: any) => void;
  onNativePress?: (e: any) => void;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

// Only require on Android — other platforms fall through to Pressable
const NativeTVFocusableView =
  Platform.OS === 'android'
    ? requireNativeComponent<NativeTVFocusableProps>('TVFocusableView')
    : null;

// ── Public props ─────────────────────────────────────────────────────────────

interface TVFocusableProps extends PressableProps {
  style?: ViewStyle | ViewStyle[] | ((state: { pressed: boolean }) => ViewStyle);
  /** Estilo aplicado quando focado (só TV) */
  focusedStyle?: ViewStyle;
  children: React.ReactNode;
  hasTVPreferredFocus?: boolean;
  /** Scale ao focar. Default 1.04 */
  focusScale?: number;
  /** @deprecated — mantido para compatibilidade */
  showAccentBar?: boolean;
  /** @deprecated — mantido para compatibilidade */
  overlayBorderRadius?: number;
}

// ── Component ────────────────────────────────────────────────────────────────

const TVFocusable = forwardRef<any, TVFocusableProps>(({
  style,
  focusedStyle,
  children,
  hasTVPreferredFocus = false,
  focusScale = 1.04,
  showAccentBar,
  overlayBorderRadius,
  disabled,
  onPress,
  onFocus: externalOnFocus,
  onBlur: externalOnBlur,
  onLongPress,
  delayLongPress,
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);

  // ── Android TV: use native view ──────────────────────────────────────────
  if (IS_TV && NativeTVFocusableView && Platform.OS === 'android') {
    // Flatten base style (no function form in native props)
    const baseStyle: ViewStyle | ViewStyle[] =
      typeof style === 'function' ? (style({ pressed: false }) as ViewStyle) : (style ?? {});

    const focusedOverride: ViewStyle = isFocused
      ? {
          borderWidth: 4,
          borderColor: '#E50000',
          shadowColor: '#E50000',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: 16,
          elevation: 24,
          transform: [{ scale: focusScale }],
          zIndex: 20,
          ...(focusedStyle ?? {}),
        }
      : {};

    return (
      <NativeTVFocusableView
        focusable={!disabled}
        disabled={!!disabled}
        hasTVPreferredFocus={hasTVPreferredFocus}
        style={[baseStyle, focusedOverride]}
        onNativeFocus={(e) => {
          setIsFocused(true);
          externalOnFocus?.(e as any);
        }}
        onNativeBlur={(e) => {
          setIsFocused(false);
          externalOnBlur?.(e as any);
        }}
        onNativePress={() => {
          if (!disabled) onPress?.({} as any);
        }}
      >
        {/* Block inner views from stealing D-Pad focus */}
        <View style={styles.innerBlock} pointerEvents="box-none">
          {children}
        </View>
      </NativeTVFocusableView>
    );
  }

  // ── Fallback: Pressable (mobile + non-Android TV) ────────────────────────
  const handleFocus = (e: any) => {
    setIsFocused(true);
    externalOnFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    externalOnBlur?.(e);
  };

  return (
    <Pressable
      ref={ref}
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={({ pressed }) => {
        const base =
          typeof style === 'function' ? style({ pressed }) : style;

        if (disabled) return base;

        if (IS_TV && isFocused) {
          return [
            base,
            {
              borderWidth: 3,
              borderColor: '#E50000',
              shadowColor: '#E50000',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 1,
              shadowRadius: 12,
              elevation: 20,
              transform: [{ scale: focusScale }],
              zIndex: 10,
            },
            focusedStyle,
          ];
        }

        if (pressed) return [base, { opacity: 0.75 }];
        return base;
      }}
      {...props}
    >
      {children}
    </Pressable>
  );
});

TVFocusable.displayName = 'TVFocusable';
export default TVFocusable;

const styles = StyleSheet.create({
  innerBlock: {
    flex: 1,
  },
});
