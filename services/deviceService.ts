/**
 * Device Service — GBTVON
 * Detects device type: phone, tablet, Android TV, TV Box, Amazon Fire TV
 * and builds an optimized profile for each.
 */
import { Platform, Dimensions } from 'react-native';

export type DeviceType = 'phone' | 'tablet' | 'androidtv' | 'tvbox';

export interface DeviceProfile {
  type: DeviceType;
  isTV: boolean;
  isMobile: boolean;
  useRemoteNavigation: boolean;
  cardWidth: number;
  fontSize: { xs: number; sm: number; md: number; lg: number; xl: number };
  spacing: { sm: number; md: number; lg: number };
  iconSize: { sm: number; md: number; lg: number };
  rowHeight: number;
  columns: number;
}

function getDeviceType(): DeviceType {
  // Platform.isTV is set by React Native for Android TV, Google TV, Fire TV
  const platformIsTV = (Platform as any).isTV === true;

  if (platformIsTV) {
    const { width } = Dimensions.get('window');
    return width >= 1280 ? 'androidtv' : 'tvbox';
  }

  const { width } = Dimensions.get('window');
  if (width >= 600) return 'tablet';
  return 'phone';
}

function buildProfile(type: DeviceType): DeviceProfile {
  const isTV = type === 'androidtv' || type === 'tvbox';

  if (isTV) {
    return {
      type,
      isTV: true,
      isMobile: false,
      useRemoteNavigation: true,
      cardWidth: type === 'androidtv' ? 240 : 200,
      fontSize: { xs: 16, sm: 18, md: 22, lg: 28, xl: 34 },
      spacing: { sm: 16, md: 28, lg: 44 },
      iconSize: { sm: 28, md: 36, lg: 52 },
      rowHeight: 88,
      columns: type === 'androidtv' ? 4 : 3,
    };
  }

  if (type === 'tablet') {
    return {
      type,
      isTV: false,
      isMobile: true,
      useRemoteNavigation: false,
      cardWidth: 160,
      fontSize: { xs: 12, sm: 14, md: 17, lg: 20, xl: 26 },
      spacing: { sm: 10, md: 18, lg: 28 },
      iconSize: { sm: 18, md: 24, lg: 36 },
      rowHeight: 68,
      columns: 4,
    };
  }

  // phone
  return {
    type,
    isTV: false,
    isMobile: true,
    useRemoteNavigation: false,
    cardWidth: 110,
    fontSize: { xs: 11, sm: 13, md: 16, lg: 18, xl: 22 },
    spacing: { sm: 8, md: 16, lg: 24 },
    iconSize: { sm: 16, md: 22, lg: 32 },
    rowHeight: 60,
    columns: 3,
  };
}

let _profile: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (!_profile) {
    _profile = buildProfile(getDeviceType());
  }
  return _profile;
}

export function isTV(): boolean {
  return getDeviceProfile().isTV;
}

export function isMobile(): boolean {
  return getDeviceProfile().isMobile;
}
