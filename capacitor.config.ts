import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.missioncontrol.app',
  appName: 'Mission Control',
  webDir: 'dist',
  server: {
    // Use https scheme on Android so cookies/storage behave like a normal web origin.
    androidScheme: 'https',
  },
}

export default config
