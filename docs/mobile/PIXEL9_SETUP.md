# Pixel 9 Android Setup

This runbook builds the Mission Control Android debug APK and connects it to the local Express API without exposing the API to the public internet.

## Server Access Model

- Default Express binding is loopback only: `127.0.0.1:3001`.
- Tailscale Serve HTTPS is the primary phone access path at home and away.
- Private-LAN HTTP is only a trusted home-network fallback.
- Do not use Tailscale Funnel.
- Do not forward router port `3001`.
- Do not commit real tailnet names, tokens, Google credentials, API keys, or personal secrets.

## Primary Path: Tailscale Serve HTTPS

Configure the host `.env`:

```powershell
API_HOST=127.0.0.1
API_PORT=3001
```

Start the API server and publish it inside the tailnet:

```powershell
npm run server
tailscale serve --bg 127.0.0.1:3001
tailscale serve status
```

Use the HTTPS URL shown by `tailscale serve status` in the Android app's Server Setup screen:

```text
https://<node>.<tailnet>.ts.net
```

That URL is private to the tailnet. It is the supported home-and-away configuration for Pixel 9 checks over Wi-Fi and cellular.

## Trusted-LAN Fallback

Use this only on a trusted home network when Tailscale is unavailable.

Configure the host `.env`:

```powershell
API_HOST=0.0.0.0
API_PORT=3001
```

Allow inbound TCP `3001` on the Windows private firewall profile only:

```powershell
New-NetFirewallRule -DisplayName "Mission Control API (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

Start the API server:

```powershell
npm run server
```

Use the PC private IP address in the Android app:

```text
http://<PC-private-IP>:3001
```

This address should work only while the phone is connected to the trusted home network.

## Android Prerequisites

- Node.js and npm installed.
- Android Studio installed with the Android SDK.
- A JDK compatible with the Android Gradle plugin.
- `adb` available on `PATH` for CLI install checks.
- Pixel 9 USB debugging enabled when physical-device validation is required.

## Build From Repo Root

```powershell
npm install
npm test
npm run build
npx cap sync android
npx cap open android
```

## CLI Debug APK

```powershell
Set-Location .\android
.\gradlew.bat assembleDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

The debug APK path is:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Automated Verification

Run this from the repository root:

```powershell
npm test
npm run build
npx cap sync android
Set-Location .\android
.\gradlew.bat testDebugUnitTest assembleDebug
```

Expected results:

- Node tests pass.
- Vite production build passes.
- Capacitor Android sync completes.
- Gradle unit tests pass.
- Debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Pixel 9 Physical Matrix

Run these checks only when ADB detects the Pixel 9.

1. Fresh install and first-launch server setup.
2. Tailscale over home Wi-Fi.
3. Tailscale over cellular.
4. Wi-Fi-to-cellular switch while the app is open.
5. Tailscale disconnect/reconnect.
6. LAN fallback on home Wi-Fi.
7. Background/resume.
8. Android back through dialog, drawer, More sheet, view history, Home exit.
9. Google OAuth return.
10. Portrait and landscape.
11. Visit Home, To-Do, Tasks, Calendar, Activity, and Settings; inspect Android Studio memory for unbounded growth.
