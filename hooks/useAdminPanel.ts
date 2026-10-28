import { useContext } from 'react';
import { AdminPanelContext } from '@/contexts/AdminPanelContext';

export function useAdminPanel() {
  const context = useContext(AdminPanelContext);
  if (!context) throw new Error('useAdminPanel must be used within AdminPanelProvider');
  return context;
}
