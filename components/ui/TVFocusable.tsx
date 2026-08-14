/**
 * TVFocusable — GBTVON (v6 — Native Visual)
 *
 * Em Android TV / TV Box:
 *   Usa TVFocusableView (componente nativo Kotlin).
 *
 *   O Android é a ÚNICA fonte da verdade.
 *   O visual (borda vermelha + estrela) é desenhado DENTRO do Kotlin
 *   em onFocusChanged → invalidate() → draw(Canvas).
 *   Zero roundtrip JS. Zero dessincronia.
 *
 *   Os eventos onNativeFocus / onNativeBlur chegam ao JS apenas para
 *   lógica de aplicação (ex: mudar aba ativa). Nunca para desenho.
 *
 * Em celular / tablet (IS_TV = false):
 *   Pressable padrão com pressed opacity.
 */
import React, { forwardRef } from 'react';
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

const NativeTVFocusableView =
  Platform.OS === 'android'
    ? requireNativeComponent<NativeTVFocusableProps>('TVFocusableView')
    : null;

// ── Public props ─────────────────────────────────────────────────────────────

interface TVFocusableProps extends PressableProps {
  style?: ViewStyle | ViewStyle[] | ((state: { pressed: boolean }) => ViewStyle);
  /**
   * focusedStyle — aplicado ao Pressable em celular quando focado via teclado.
   * Em Android TV é ignorado (o visual é nativo).
   */
  focusedStyle?: ViewStyle;
  children: React.ReactNode;
  hasTVPreferredFocus?: boolean;
  focusScale?: number;
  /** @deprecated mantido para não quebrar chamadores */
  showAccentBar?: boolean;
  /** @deprecated mantido para não quebrar chamadores */
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

  // ── Android TV: visual is 100% native, JS just routes events ────────────
  if (IS_TV && NativeTVFocusableView && Platform.OS === 'android') {
    const baseStyle: ViewStyle | ViewStyle[] =
      typeof style === 'function' ? (style({ pressed: false }) as ViewStyle) : (style ?? {});

    return (
      <NativeTVFocusableView
        focusable={!disabled}
        disabled={!!disabled}
        hasTVPreferredFocus={hasTVPreferredFocus}
        style={baseStyle}
        onNativeFocus={(e) => externalOnFocus?.(e as any)}
        onNativeBlur={(e) => externalOnBlur?.(e as any)}
        onNativePress={() => { if (!disabled) onPress?.({} as any); }}
      >
        {/*
          IMPORTANT: overflow:visible ensures the Canvas drawing in
          TVFocusableView.onDraw (red border + star) is NOT clipped by
          the child View bounds. The native border is drawn by the Kotlin
          layer — this inner View must not clip or cover it.
        */}
        <View style={styles.innerBlock} pointerEvents="box-none">
          {children}
        </View>
      </NativeTVFocusableView>
    );
  }

  // ── Fallback: Pressable (mobile / non-Android) ───────────────────────────
  return (
    <Pressable
      ref={ref}
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={externalOnFocus}
      onBlur={externalOnBlur}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={({ pressed }) => {
        const base = typeof style === 'function' ? style({ pressed }) : style;
        if (pressed && !disabled) return [base, { opacity: 0.75 }];
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
    // overflow:visible so the native Canvas border drawn by TVFocusableView
    // is not clipped by this child View's bounds.
    overflow: 'visible',
  },
});
