/**
 * TVFocusable — GBTVON (v7 — Lazy Native + Crash-Safe)
 *
 * Em Android TV / TV Box:
 *   Usa TVFocusableView (componente nativo Kotlin).
 *   requireNativeComponent é chamado de forma LAZY (dentro do render),
 *   não em tempo de avaliação do módulo — evita crash no boot do Android TV.
 *
 *   O Android é a ÚNICA fonte da verdade do foco visual.
 *   O visual (borda vermelha + estrela) é desenhado no Kotlin via
 *   onFocusChanged → hasVisualFocus → invalidate() → dispatchDraw(Canvas).
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

// ── Native component — lazy singleton ───────────────────────────────────────
//
// requireNativeComponent must NOT be called at module evaluation time on
// Android TV. The native module registry may not be fully initialized when
// JS modules are first evaluated during the bundle load. Calling it eagerly
// triggers "Cannot find native component 'TVFocusableView'" and crashes the
// app before any UI is rendered.
//
// Solution: cache the result in a module-level variable but only resolve it
// on the first render call, inside a try/catch so a missing registration
// gracefully falls back to Pressable instead of crashing.

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

let _nativeViewCache: React.ComponentType<NativeTVFocusableProps> | null | undefined = undefined;

function getNativeView(): React.ComponentType<NativeTVFocusableProps> | null {
  if (Platform.OS !== 'android') return null;
  if (_nativeViewCache !== undefined) return _nativeViewCache;
  try {
    _nativeViewCache = requireNativeComponent<NativeTVFocusableProps>('TVFocusableView');
  } catch {
    // TVFocusableView not registered (e.g. Expo Go, simulator) — fallback to Pressable
    _nativeViewCache = null;
  }
  return _nativeViewCache;
}

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

  // ── Android TV path: lazy-resolve native view, fallback to Pressable ────
  if (IS_TV && Platform.OS === 'android') {
    const NativeView = getNativeView();

    if (NativeView) {
      const baseStyle: ViewStyle | ViewStyle[] =
        typeof style === 'function' ? (style({ pressed: false }) as ViewStyle) : (style ?? {});

      return (
        <NativeView
          focusable={!disabled}
          disabled={!!disabled}
          hasTVPreferredFocus={hasTVPreferredFocus}
          style={baseStyle}
          onNativeFocus={(e) => externalOnFocus?.(e as any)}
          onNativeBlur={(e) => externalOnBlur?.(e as any)}
          onNativePress={() => { if (!disabled) onPress?.({} as any); }}
        >
          {/*
            overflow:visible ensures the Canvas drawing in
            TVFocusableView.dispatchDraw (red border + star) is NOT clipped
            by this child View's bounds. pointerEvents via style (RN 0.74+).
          */}
          <View style={styles.innerBlock}>
            {children}
          </View>
        </NativeView>
      );
    }
    // Native view not available — fall through to Pressable
  }

  // ── Fallback: Pressable (mobile / non-Android / native view unavailable) ─
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
    // (in dispatchDraw) is never clipped by this child View.
    overflow: 'visible',
    // pointerEvents:'box-none' via style (required for RN 0.74+)
    pointerEvents: 'box-none',
  },
});
