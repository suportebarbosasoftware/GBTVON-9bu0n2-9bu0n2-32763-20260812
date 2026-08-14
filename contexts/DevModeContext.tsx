/**
 * DevModeContext — GBTVON
 * Gerencia o estado global do modo desenvolvedor (D-Pad overlay de teste de foco).
 * Ativado por 7 toques na foto de perfil; disponível em qualquer tela.
 */
import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

interface DevModeContextType {
  devMode: boolean;
  enableDevMode: () => void;
  disableDevMode: () => void;
  toggleDevMode: () => void;
  /** Registra um toque na sequência de ativação. Retorna o número de toques restantes. */
  registerTap: () => number;
}

const DevModeContext = createContext<DevModeContextType | undefined>(undefined);

export function DevModeProvider({ children }: { children: React.ReactNode }) {
  const [devMode, setDevMode] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enableDevMode = useCallback(() => setDevMode(true), []);
  const disableDevMode = useCallback(() => setDevMode(false), []);
  const toggleDevMode = useCallback(() => setDevMode(v => !v), []);

  const registerTap = useCallback((): number => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2500);

    if (tapCount.current >= 7) {
      tapCount.current = 0;
      setDevMode(v => !v);
      return 0;
    }
    return 7 - tapCount.current;
  }, []);

  return (
    <DevModeContext.Provider value={{ devMode, enableDevMode, disableDevMode, toggleDevMode, registerTap }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode() {
  const ctx = useContext(DevModeContext);
  if (!ctx) throw new Error('useDevMode must be used within DevModeProvider');
  return ctx;
}
