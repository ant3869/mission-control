import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.missioncontrol.app',
  appName: 'Mission Control',
  webDir: 'dist',
  server: {
    // Keep the WebView origin HTTPS; the API server URL is configured at runtime.
    androidScheme: 'https',
  },
}

export default config
