/**
 * useTV — GBTVON
 *
 * Central hook for TV detection, D-Pad navigation, and responsive scaling.
 * Works with Android TV, Google TV, TV Box, and Amazon Fire TV.
 *
 * Orientation policy:
 *  - Android TV / TV Box: always landscape (hardware enforced)
 *  - Phones / tablets: free orientation (default / portrait)
 *
 * D-Pad navigation is handled natively by the Android focus system through
 * Pressable `focusable={true}`. No manual TVEventHandler needed.
 */
import { Platform, Dimensions } from 'react-native';
import { getDeviceProfile } from '@/services/deviceService';

const profile = getDeviceProfile();
const { width, height } = Dimensions.get('window');

/**
 * True when running on Android TV / Google TV / TV Box / Fire TV.
 * Detection is based on Platform.isTV (set by React Native for Leanback devices)
 * and the screen width heuristic in deviceService. This must NOT be hardcoded.
 */
export const IS_TV: boolean = profile.isTV;

/**
 * Returns TV-scaled value when on TV, otherwise the mobile value.
 */
export function tvVal<T>(mobileVal: T, tvValue: T): T {
  return IS_TV ? tvValue : mobileVal;
}

/** TV-optimized sizes for common UI tokens */
export const TV = {
  fontSize: {
    xs: tvVal(11, 16),
    sm: tvVal(13, 18),
    md: tvVal(16, 22),
    lg: tvVal(18, 26),
    xl: tvVal(22, 32),
    xxl: tvVal(28, 40),
  },
  spacing: {
    xs: tvVal(4, 8),
    sm: tvVal(8, 16),
    md: tvVal(16, 28),
    lg: tvVal(24, 40),
    xl: tvVal(32, 56),
  },
  iconSize: {
    sm: tvVal(18, 28),
    md: tvVal(24, 36),
    lg: tvVal(32, 48),
    xl: tvVal(40, 64),
  },
  buttonHeight: tvVal(44, 64),
  cardRadius: tvVal(10, 16),
  rowHeight: tvVal(60, 88),
  panelWidth: tvVal(320, 460),
};

export type DPadEvent =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'playPause'
  | 'fastForward'
  | 'rewind'
  | 'menu';

type DPadHandler = (event: DPadEvent) => void;

/**
 * useTVRemote — subscribes to hardware D-pad / remote control events.
 *
 * Navigation on Android TV is handled natively through the Pressable focus
 * system — the OS routes DPAD_UP/DOWN/LEFT/RIGHT to the focused element.
 * This hook is intentionally a safe no-op to avoid NativeModule crashes on
 * Expo managed workflow builds.
 */
export function useTVRemote(_onEvent: DPadHandler, _active = true) {
  // Intentional no-op: D-Pad routing is handled by Android's native focus system.
  // All interactive elements use TVFocusable (focusable={true}) which receives
  // focus automatically via directional navigation without any JS event handler.
}

/**
 * isLandscapeDevice — true when the device is in landscape orientation
 * or is a TV (which is always landscape).
 */
export const isLandscapeDevice: boolean = IS_TV || width > height;
