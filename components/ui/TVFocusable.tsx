/**
 * Elemento interativo compartilhado entre celular e Android TV.
 *
 * A navegação é conduzida pelo foco nativo do Android através de Pressable.
 * O indicador visual é único e global na Activity Android, portanto acompanha
 * qualquer controle focável sem substituir o componente que recebe os toques.
 */
import React, { forwardRef } from 'react';
import {
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';

interface TVFocusableProps extends PressableProps {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Mantido por compatibilidade; o indicador visual é global e nativo. */
  focusedStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  hasTVPreferredFocus?: boolean;
  focusScale?: number;
  /** @deprecated Mantido para não quebrar chamadores existentes. */
  showAccentBar?: boolean;
  /** @deprecated Mantido para não quebrar chamadores existentes. */
  overlayBorderRadius?: number;
}

const TVFocusable = forwardRef<any, TVFocusableProps>(({
  style,
  focusedStyle: _focusedStyle,
  children,
  hasTVPreferredFocus = false,
  focusScale: _focusScale = 1.04,
  showAccentBar: _showAccentBar,
  overlayBorderRadius: _overlayBorderRadius,
  disabled,
  onPress,
  onFocus,
  onBlur,
  onLongPress,
  delayLongPress,
  ...props
}, ref) => (
  <Pressable
    ref={ref}
    focusable={!disabled}
    hasTVPreferredFocus={hasTVPreferredFocus}
    disabled={disabled}
    onPress={onPress}
    onFocus={onFocus}
    onBlur={onBlur}
    onLongPress={onLongPress}
    delayLongPress={delayLongPress}
    style={({ pressed }) => [
      typeof style === 'function' ? style({ pressed }) : style,
      pressed && !disabled && styles.pressed,
    ]}
    {...props}
  >
    {children}
  </Pressable>
));

TVFocusable.displayName = 'TVFocusable';
export default TVFocusable;

const styles = StyleSheet.create({
  // Touch feedback stays unchanged on phones. TV focus is drawn globally by Android.
  pressed: {
    opacity: 0.78,
  },
});
