import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: appId and server.androidScheme must never change after the first release
// (a different scheme changes the WebView origin and makes saved games disappear).
const config: CapacitorConfig = {
  appId: 'com.bigssu.lotandroll',
  appName: '랏앤롤',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#1E2A3A',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#1E2A3A',
      showSpinner: false,
    },
  },
};

export default config;
