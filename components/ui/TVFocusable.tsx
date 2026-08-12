/**
 * TVFocusable — GBTVON (v4)
 *
 * Pressable wrapper com foco visual para D-Pad.
 *
 * PRINCÍPIO: foco nativo Android TV é a fonte da verdade.
 * onFocus → destaque visual imediato no próprio elemento.
 * onBlur  → remove destaque.
 * Sem overlay separado. Zero conflito com indicador nativo.
 *
 * Em celular/tablet (IS_TV = false): comportamento padrão de Pressable,
 * sem borda vermelha ou scale de TV.
 */
import React, { useState, forwardRef } from 'react';
import { Pressable, ViewStyle, PressableProps } from 'react-native';
import { IS_TV } from '@/hooks/useTV';

interface TVFocusableProps extends PressableProps {
  style?: ViewStyle | ViewStyle[] | ((state: { pressed: boolean }) => ViewStyle);
  /** Estilo aplicado quando o item está focado (só em IS_TV=true) */
  focusedStyle?: ViewStyle;
  children: React.ReactNode;
  hasTVPreferredFocus?: boolean;
  /** Scale ao focar. Só aplicado em IS_TV. Default 1.04 */
  focusScale?: number;
  /** Ignorado — mantido para compatibilidade */
  showAccentBar?: boolean;
  /** Ignorado — mantido para compatibilidade */
  overlayBorderRadius?: number;
}

const TVFocusable = forwardRef<any, TVFocusableProps>(({
  style,
  focusedStyle,
  children,
  hasTVPreferredFocus = false,
  focusScale = 1.04,
  showAccentBar,
  overlayBorderRadius,
  disabled,
  onFocus: externalOnFocus,
  onBlur: externalOnBlur,
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);

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
      style={({ pressed }) => {
        const base =
          typeof style === 'function' ? style({ pressed }) : style;

        if (disabled) return base;

        // TV: apply red focus ring driven by native onFocus/onBlur
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

        // Mobile: only opacity feedback on press, no TV focus ring
        if (pressed) {
          return [base, { opacity: 0.75 }];
        }

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
