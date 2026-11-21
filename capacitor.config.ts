import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.messpass.app',
  appName: 'Mess Pass',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
