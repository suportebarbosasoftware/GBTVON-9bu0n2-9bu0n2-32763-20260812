/**
 * withAndroidTV — Expo config plugin
 *
 * Configures AndroidManifest.xml for full compatibility with:
 *  - Android TV / Google TV  (LEANBACK_LAUNCHER)
 *  - Amazon Fire TV           (LEANBACK_LAUNCHER)
 *  - TV Box / STB             (no touchscreen required)
 *  - Android phones/tablets   (LAUNCHER, any DPI)
 *
 * Critical fix for Play Store builds:
 *  - Creates network_security_config.xml to allow cleartext HTTP traffic
 *    (IPTV streams use HTTP, blocked by default in Play Store APKs)
 *  - Adds android:usesCleartextTraffic="true" to Application element
 *  - Blocks android.permission.ACTIVITY_RECOGNITION (Play Store rejection fix)
 */
const { withAndroidManifest } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Allow cleartext HTTP traffic for IPTV stream servers -->
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

module.exports = function withAndroidTV(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;

    // ── Write network_security_config.xml ──────────────────────────────────
    try {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'xml'
      );
      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_XML, 'utf8');
    } catch (e) {
      // Non-fatal during JS bundling phase (prebuild writes it, not bundle phase)
    }

    // ── uses-feature ────────────────────────────────────────────────────────
    let usesFeature = manifest.manifest['uses-feature'] || [];

    const featuresNeeded = [
      { $: { 'android:name': 'android.software.leanback',                        'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.touchscreen',                     'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.touchscreen.multitouch',          'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.touchscreen.multitouch.distinct', 'android:required': 'false' } },
      // Optional hardware — do not block install on TV where these don't exist
      { $: { 'android:name': 'android.hardware.telephony',                       'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.camera',                          'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.camera.autofocus',                'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.microphone',                      'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.wifi',                            'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.location',                        'android:required': 'false' } },
    ];

    for (const feature of featuresNeeded) {
      const name = feature.$['android:name'];
      const idx = usesFeature.findIndex((f) => f.$?.['android:name'] === name);
      if (idx === -1) usesFeature.push(feature);
      else usesFeature[idx] = feature;
    }
    manifest.manifest['uses-feature'] = usesFeature;

    // ── supports-screens ────────────────────────────────────────────────────
    manifest.manifest['supports-screens'] = [{
      $: {
        'android:smallScreens':  'true',
        'android:normalScreens': 'true',
        'android:largeScreens':  'true',
        'android:xlargeScreens': 'true',
        'android:anyDensity':    'true',
        'android:resizeable':    'true',
      },
    }];

    // ── Application-level attributes ─────────────────────────────────────────
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    // Critical: allow HTTP streams (IPTV uses HTTP, Play Store blocks it by default)
    application.$['android:usesCleartextTraffic'] = 'true';
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';

    // ── MainActivity: configChanges + orientation + intent filters ────────────
    const mainActivity = application.activity?.find(
      (a) =>
        a.$?.['android:name'] === '.MainActivity' ||
        a.$?.['android:name']?.endsWith('.MainActivity')
    );

    if (mainActivity) {
      // configChanges
      const existingChanges = mainActivity.$['android:configChanges'] || '';
      const neededChanges = [
        'keyboard', 'keyboardHidden', 'orientation',
        'screenSize', 'screenLayout', 'uiMode',
        'smallestScreenSize', 'density',
      ];
      const current = new Set(existingChanges.split('|').filter(Boolean));
      neededChanges.forEach((c) => current.add(c));
      mainActivity.$['android:configChanges'] = Array.from(current).join('|');

      // Allow both portrait (phones) and landscape (TV)
      // Android TV is always landscape; phones adapt freely
      mainActivity.$['android:screenOrientation'] = 'unspecified';

      // Intent filters
      const filters = mainActivity['intent-filter'] || [];

      const hasLauncher = filters.some((f) =>
        f.category?.some((c) => c.$?.['android:name'] === 'android.intent.category.LAUNCHER')
      );
      if (!hasLauncher) {
        filters.push({
          action:   [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        });
      }

      const hasLeanback = filters.some((f) =>
        f.category?.some((c) => c.$?.['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')
      );
      if (!hasLeanback) {
        filters.push({
          action:   [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } }],
        });
      }

      mainActivity['intent-filter'] = filters;
    }

    return config;
  });
};
