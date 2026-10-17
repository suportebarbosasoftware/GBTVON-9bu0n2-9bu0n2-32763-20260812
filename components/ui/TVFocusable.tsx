/**
 * Elemento interativo compartilhado entre celular e Android TV.
 *
 * A navegação é conduzida pelo foco nativo do Android através de Pressable.
 * O indicador visual é único e global na Activity Android, portanto acompanha
 * qualquer controle focável sem substituir o componente que recebe os toques.
 */
import React, { forwardRef, useEffect, useRef } from 'react';
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
  /** Eventos DOM usados somente pelo controle remoto webOS na versão web. */
  onKeyDown?: (event: any) => void;
  onKeyUp?: (event: any) => void;
}

// PressableProps não declara os eventos de teclado da web, embora o componente
// web os encaminhe corretamente ao elemento focável.
const WebPressable = Pressable as any;

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
  onKeyDown,
  onKeyUp,
  ...props
}, ref) => {
  const elementRef = useRef<any>(null);
  const remoteLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteLongPressFired = useRef(false);

  // React Native Web does not translate a held TV Enter key into
  // Pressable.onLongPress. The global webOS navigator emits this DOM event;
  // bridge it back to the normal React Native callback here.
  useEffect(() => {
    const element = elementRef.current as HTMLElement | null;
    if (!element || !onLongPress) return;
    const handler = () => onLongPress({} as any);
    (element as any).__webosLongPress = handler;
    element.addEventListener('webos-longpress', handler);
    return () => {
      if ((element as any).__webosLongPress === handler) delete (element as any).__webosLongPress;
      element.removeEventListener('webos-longpress', handler);
    };
  }, [onLongPress]);

  const setRef = (node: any) => {
    elementRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref && typeof ref === 'object') (ref as any).current = node;
  };

  // webOS envia Enter repetidamente enquanto OK permanece pressionado, mas o
  // React Native Web não traduz isso em onLongPress. Tratamos aqui, no cartão
  // que recebe o foco, para impedir que o clique normal abra o conteúdo antes
  // de o favorito ser salvo.
  const isConfirmKey = (event: any) => event?.key === 'Enter' || event?.key === ' ' || event?.keyCode === 13;
  const handleKeyDown = (event: any) => {
    onKeyDown?.(event);
    if (!onLongPress || !isConfirmKey(event)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (remoteLongPressTimer.current) return;
    remoteLongPressFired.current = false;
    remoteLongPressTimer.current = setTimeout(() => {
      remoteLongPressTimer.current = null;
      remoteLongPressFired.current = true;
      onLongPress({} as any);
    }, delayLongPress ?? 550);
  };

  const handleKeyUp = (event: any) => {
    onKeyUp?.(event);
    if (!onLongPress || !isConfirmKey(event)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (remoteLongPressTimer.current) {
      clearTimeout(remoteLongPressTimer.current);
      remoteLongPressTimer.current = null;
    }
    if (!remoteLongPressFired.current) onPress?.({} as any);
    remoteLongPressFired.current = false;
  };

  useEffect(() => () => {
    if (remoteLongPressTimer.current) clearTimeout(remoteLongPressTimer.current);
  }, []);

  return <WebPressable
    ref={setRef}
    focusable={!disabled}
    // In the LG browser a React Native Web Pressable can expose role=button
    // without being in the browser's tab sequence.  Make every TV card an
    // explicit focus stop so the D-pad moves from card to card instead of
    // leaving the Magic Remote in pointer-only navigation.
    tabIndex={disabled ? -1 : 0}
    accessibilityRole="button"
    hasTVPreferredFocus={hasTVPreferredFocus}
    disabled={disabled}
    onPress={onPress}
    onFocus={onFocus}
    onBlur={onBlur}
    onLongPress={onLongPress}
    delayLongPress={delayLongPress}
    onKeyDown={handleKeyDown}
    onKeyUp={handleKeyUp}
    style={({ pressed }) => [
      typeof style === 'function' ? style({ pressed }) : style,
      pressed && !disabled && styles.pressed,
    ]}
    {...props}
  >
    {children}
  </WebPressable>
});

TVFocusable.displayName = 'TVFocusable';
export default TVFocusable;

const styles = StyleSheet.create({
  // Touch feedback stays unchanged on phones. TV focus is drawn globally by Android.
  pressed: {
    opacity: 0.78,
  },
});
