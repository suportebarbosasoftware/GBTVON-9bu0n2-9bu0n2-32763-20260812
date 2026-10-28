import { useContext } from 'react';
import { RepPanelContext } from '@/contexts/RepPanelContext';

export function useRepPanel() {
  const context = useContext(RepPanelContext);
  if (!context) throw new Error('useRepPanel must be used within RepPanelProvider');
  return context;
}
