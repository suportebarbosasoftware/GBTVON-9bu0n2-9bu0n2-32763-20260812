import { Redirect } from 'expo-router';

/**
 * webOS opens packaged apps through a `file:///.../index.html` URL.  Expo
 * Router sees that absolute file-system path as an unknown route after the
 * page hydrates.  Route it back into the application instead of displaying
 * Expo's not-found screen.
 */
export default function WebOSFileLaunchFallback() {
  return <Redirect href="/" />;
}
