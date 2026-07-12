# Mission Control Capacitor Responsive Mobile Design

**Date:** 2026-07-11
**Target device:** Google Pixel 9
**Primary platform:** Android through Capacitor 8
**Repository:** `ant3869/mission-control`

## 1. Goal

Turn the existing Mission Control React application into a practical personal Android application without replacing the current frontend or backend. Preserve the existing deep-dark command-center identity while creating phone-native navigation, touch targets, layouts, loading states, and networking behavior.

The first usable release must support the daily-use areas on the Pixel 9: Home, To-Do/Tasks/Approvals/Inbox, To-Buy, Calendar, Settings, global search, and server connectivity. Remaining monitoring and analytics screens follow using the same mobile shell and responsive component patterns.

## 2. Selected approach

Use the existing React 18, TypeScript, Tailwind CSS, Express 5, and Capacitor 8 stack.

The Android application packages only the frontend. The Express backend remains on the Mission Control host because it owns SQLite/JSON data, local file access, Google credentials, OpenClaw/Hermes connectivity, Discord integration, SSH access, and system diagnostics.

The frontend continues to serve desktop browsers. At phone widths it switches to a dedicated mobile shell instead of shrinking the desktop sidebar.

## 3. Non-goals

- No React Native or Expo rewrite.
- No attempt to run the Express backend inside Android.
- No public unauthenticated port forwarding.
- No full offline mutation queue in the first release.
- No redesign of Mission Control's color palette or branding.
- No requirement to optimize for every Android device.
- No requirement to publish through Google Play; direct APK installation is sufficient.

## 4. Current-state findings

- Capacitor Android and iOS projects already exist.
- `capacitor.config.ts` uses `webDir: 'dist'` and Android's HTTPS local scheme.
- `src/lib/api.ts` supports a build-time `VITE_API_BASE_URL`, but many components still call relative `/api` URLs directly.
- `src/App.tsx` always renders the desktop sidebar and desktop top bar.
- Most views are dense dashboard layouts designed for medium or desktop widths.
- The server CORS list does not include the Android WebView origin `https://localhost`.
- The API has rate limiting but no application login; the secure remote-access boundary must therefore be Tailscale rather than a publicly reachable Express port.
- The existing design system is strong and should remain authoritative.

## 5. Architecture

```text
Google Pixel 9
└── Mission Control Android app
    ├── Capacitor native shell
    ├── React mobile shell
    ├── Runtime server configuration
    └── HTTPS requests and SSE
        └── Tailscale Serve URL
            └── Express API on Mission Control host
                ├── SQLite and JSON stores
                ├── OpenClaw and Hermes
                ├── Google Calendar
                ├── Discord
                └── local machine and SSH integrations
```

Desktop browser usage remains:

```text
Desktop browser
└── Vite/production frontend
    └── same-origin /api requests
        └── Express API
```

## 6. Runtime server configuration

### 6.1 Configuration precedence

The frontend resolves its backend base URL in this order:

1. Native runtime value stored under `mc:server-base-url`.
2. `VITE_API_BASE_URL` supplied during a build.
3. Empty string, which means same-origin web behavior.

The stored value is normalized by trimming whitespace and removing trailing slashes.

### 6.2 First-launch behavior

When running inside Capacitor and no runtime URL or build URL exists, the app opens a required server setup screen before loading the dashboard.

The screen contains:

- Server URL input.
- `Test connection` button.
- Successful response details: host, API status, and response time.
- Clear guidance that the preferred address is the HTTPS Tailscale Serve hostname.
- A LAN fallback example using `http://<local-ip>:3001`.
- A save button enabled only after a successful `/api/health` request.

The value can later be changed from Settings.

### 6.3 Shared request layer

Create one URL and fetch abstraction used by all frontend code:

- `getApiBaseUrl(): string`
- `setApiBaseUrl(value: string): void`
- `clearApiBaseUrl(): void`
- `apiUrl(path: string): string`
- `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`
- `apiDownloadUrl(path: string): string`

`apiUrl` accepts API paths beginning with `/api/` and produces either an absolute server URL or the original same-origin path.

All direct calls such as `fetch('/api/todos')`, `new EventSource('/api/watch/stream')`, export links, OAuth links, and generated download URLs must use this layer.

### 6.4 Request behavior

- Default timeout: 15 seconds for normal requests.
- Health-check timeout: 8 seconds.
- JSON parse failures produce a typed API error.
- HTTP failures expose status and backend error text.
- Network failures expose a user-readable connection error.
- Mutations are not automatically retried.
- Idempotent dashboard reads may be retried manually through the UI.

## 7. Backend networking and security

### 7.1 Primary remote-access configuration

Use Tailscale on both the Pixel 9 and the Mission Control host. The expected host is `hp-nexco`, but the app stores the full URL rather than hardcoding a machine name or tailnet suffix.

The Express API binds to loopback by default:

```env
API_HOST=127.0.0.1
API_PORT=3001
```

Tailscale Serve terminates HTTPS and proxies the tailnet-only hostname to `http://127.0.0.1:3001`.

The Android app connects to the resulting HTTPS hostname. This is the default documented configuration for home and away use.

No Tailscale Funnel configuration is included. No router port-forwarding is included.

### 7.2 LAN fallback

For same-network access, the server may be launched with:

```env
API_HOST=0.0.0.0
API_PORT=3001
```

The Android app then uses `http://<trusted-lan-ip>:3001`.

This mode requires a Windows/Linux firewall rule restricted to the private network. It is documented as trusted-LAN-only and is not presented as safe for public internet exposure.

### 7.3 CORS

The server allows:

- `http://localhost:5173`
- `http://localhost`
- `https://localhost`
- `capacitor://localhost`
- `ionic://localhost`
- optional origins supplied by `CORS_ORIGINS` as a comma-separated environment variable

Requests without an `Origin` header remain allowed for CLI and local integrations.

### 7.4 Authentication boundary

Version one relies on Tailscale identity and ACLs for remote access. The Express API is never documented or configured as publicly reachable.

Cloudflare Tunnel is deferred because adding Cloudflare Access, browser authentication, callback handling, and cookie behavior would add complexity without improving the personal-use path.

## 8. Mobile application shell

### 8.1 Breakpoint

The dedicated phone shell activates below `768px`. The primary design reference is a 412px-wide viewport, with verification at 360px, 393px, and 412px.

Tablet and desktop widths retain the existing sidebar layout.

### 8.2 Layout

```text
┌──────────────────────────────────────┐
│ compact top bar                      │
├──────────────────────────────────────┤
│                                      │
│ active view                          │
│                                      │
├──────────────────────────────────────┤
│ Home  To-Do  Calendar  Activity More │
└──────────────────────────────────────┘
```

The root uses `100dvh` and safe-area padding. Content scroll belongs to the active view. The top and bottom bars remain fixed within the application shell.

### 8.3 Mobile top bar

The top bar includes:

- Current page title.
- Compact connectivity indicator.
- Search button.
- Quick-add button.

Desktop-only keyboard shortcut labels and pause text are hidden. Pause remains accessible from the More sheet or an overflow action.

### 8.4 Bottom navigation

The fixed bottom destinations are:

1. Home
2. To-Do
3. Calendar
4. Activity
5. More

Each target is at least 48px high, has an icon and short label, and supports Android's bottom safe area.

Badges remain available for To-Do and Health-related information. The More item may show a warning dot when Health contains warning or critical alerts.

### 8.5 More sheet

More opens a full-height bottom sheet containing the existing sections:

- Work
- Knowledge
- Build
- AI Ops
- Settings

The sheet preserves the current grouping, icons, labels, and badges. Selecting an item closes the sheet and navigates to the selected view.

### 8.6 Navigation history and Android back

Maintain an in-memory stack of visited views.

Back-button order:

1. Close the active dialog, full-screen drawer, search overlay, or More sheet.
2. Return to the previous view in the stack.
3. If no previous view exists and the current view is not Home, navigate to Home.
4. On Home with no overlay or history, allow the normal Android exit behavior.

### 8.7 Mounted-view policy

Desktop retains the existing keep-mounted behavior.

Mobile renders only the active view, except for an overlay currently being dismissed. This reduces memory use from large analytics screens and long lists.

## 9. Mobile visual system

The existing design tokens remain authoritative:

- Base `#0b0b0d`
- Surface `#0f0f12`
- Card `#141417`
- Card hover `#1a1a1e`
- Existing semantic green, amber, red, blue, purple, and teal accents
- Outfit body typography
- JetBrains Mono telemetry typography
- Maximum `rounded-xl`

Mobile-specific changes are structural rather than decorative:

- 16px horizontal page padding.
- 12px card gaps.
- 44–48px minimum interactive targets.
- Minimum 16px input font size to avoid mobile zoom behavior.
- No page-level horizontal overflow.
- Hover-only controls become persistent or available through touch menus.
- Detail drawers become full-screen mobile panels.
- Desktop modals become full-screen dialogs or bottom sheets.
- Dense rows wrap into stacked metadata blocks.

## 10. Global connection states

### 10.1 Connectivity state model

The app exposes:

- `checking`
- `online`
- `degraded`
- `offline`
- `misconfigured`

### 10.2 Global UI

- Initial connection check shows the shell and a non-blocking loading state.
- An unreachable configured server shows a persistent banner with Retry and Server Settings.
- A disconnected SSE stream does not mark the entire API offline if health requests still succeed.
- Read screens keep their last successful content while displaying stale status.
- Mutations show a clear failure and do not optimistically claim success.
- When the device regains connectivity, the app refreshes the active view and reconnects SSE.

### 10.3 Local caching

Version one caches only configuration and existing browser-local UI preferences. Server data is not promoted to an offline source of truth.

## 11. Google authentication

Google OAuth remains hosted by the Express backend.

- The Settings Google connect action constructs an absolute URL through `apiUrl('/api/auth/google')`.
- In Capacitor it opens through `@capacitor/browser`.
- Returning to the Mission Control app triggers an authentication-status refresh through `@capacitor/app` resume events.
- No client secret or Google refresh token is stored in Android.

## 12. Screen adaptations

### 12.1 Home

- Greeting and status stay at the top.
- Radar shrinks and moves beside compact event/status information when space permits; below 393px it stacks.
- Metrics use a two-column grid with the heartbeat card spanning the full width.
- The highest-priority item appears before supporting cards.
- Supporting panels stack in one column.
- Large desktop typography is reduced while retaining the existing visual hierarchy.
- Raw relative fetches are replaced with the shared API client.

### 12.2 To-Do hub

- To-Do, Tasks, Approvals, and Inbox use a horizontally scrollable segmented tab strip.
- Quick capture remains visible near the top.
- Lists use one-column cards.
- Bulk selection actions become a sticky context bar above bottom navigation.
- Kanban status columns become a selected-status filter on mobile.
- Detail drawers become full-screen panels.
- Drag-and-drop remains desktop-only; mobile status changes use a menu or explicit action.

### 12.3 To-Buy

- Estimated total remains pinned near the top.
- Items render as stacked touch cards.
- Quantity, priority, price, and purchase status wrap cleanly.
- Research results and details use a full-screen panel.

### 12.4 Calendar

- Agenda is the default mobile view.
- Day and Month remain available.
- Week remains available behind the view selector but may use an internally pannable grid.
- The event editor becomes a full-screen form.
- Date navigation controls use 44px targets.

### 12.5 Settings

- Server Connection becomes the first mobile section.
- It shows current URL, connection status, Test, Change, and Reset actions.
- Connector cards stack with full-width inputs.
- Google OAuth uses the Capacitor browser behavior.
- Export and backup uses the absolute backend URL and native/browser download behavior supported by the WebView.

### 12.6 Search and quick capture

- Global search opens full-screen on mobile.
- The search input stays fixed at the top while results scroll.
- Keyboard-navigation help is hidden on touch devices.
- Quick To-Do capture becomes a bottom sheet above the software keyboard.

### 12.7 Projects and pipeline

- Project cards stack vertically.
- Kanban columns become status-filtered lists.
- Gantt and pipeline diagrams may pan horizontally inside a bounded visualization container; the page itself must not scroll sideways.

### 12.8 Inventory, Ideas, News, Docs, Links, Memory, and Chats

- Cards stack in one column.
- Filters open through a filter sheet.
- Metadata wraps into two-line groups.
- Selected item details open full-screen.
- Chats preserve structured tool-call rendering with mobile-safe code wrapping and bounded preformatted output.

### 12.9 Activity, Usage, Health, Benchmarks, and Evaluations

- Summary cards render first.
- Wide tables become card lists.
- Charts receive phone-specific heights and reduced axis labels.
- Advanced metadata lives in expandable sections.
- Node maps, heatmaps, Gantt charts, and scatter plots may pan internally when necessary.

## 13. Capacitor integration

Add and use:

- `@capacitor/app` for resume and Android back handling.
- `@capacitor/browser` for Google OAuth and external links.
- `@capacitor/status-bar` for dark status-bar styling matching the app shell.

Android configuration must:

- Keep internet permission.
- Retain cleartext support only for the documented LAN fallback.
- Use the Mission Control app ID and launcher identity already present.
- Use dark system bars matching the base/surface palette.

## 14. Testing strategy

### 14.1 Automated tests

Add tests for:

- API URL precedence and normalization.
- Same-origin URL construction.
- Absolute Tailscale and LAN URL construction.
- Typed timeout, network, parse, and HTTP errors.
- Server setup validation.
- Navigation history behavior.
- Mobile-versus-desktop mounted-view behavior.
- Backend host binding and CORS origin acceptance.

Existing server tests must continue passing.

### 14.2 Browser testing

Test responsive widths:

- 360 × 800
- 393 × 852
- 412 × 915
- 768 × 1024
- Existing desktop width

Verify:

- No page-level horizontal scrollbar.
- Every navigation destination remains reachable.
- Dialogs and drawers fit above bottom navigation.
- The software keyboard does not cover submit controls.
- Touch targets are usable.
- Empty, loading, stale, and failed states are visible.

### 14.3 Physical Pixel 9 testing

Test the APK on the Pixel 9 for:

- Initial server setup.
- Tailscale on Wi-Fi.
- Tailscale on cellular.
- LAN fallback on the home network.
- Switching between Wi-Fi and cellular while the app is open.
- Tailscale disconnect and reconnect.
- App background and resume.
- Android back behavior.
- Google OAuth return flow.
- Gesture navigation safe areas.
- Portrait and landscape behavior.
- Long lists, charts, and memory use after visiting several screens.

## 15. Delivery milestones

### Milestone 1: Working personal Android app

Includes:

- Complete request-layer migration.
- Runtime server setup.
- Tailscale Serve documentation.
- LAN fallback documentation.
- Mobile shell, top bar, bottom navigation, More sheet, back behavior, and safe areas.
- Global connection and error states.
- Home.
- To-Do/Tasks/Approvals/Inbox.
- To-Buy.
- Calendar.
- Settings.
- Search and quick capture.
- Debug APK build and Pixel 9 installation instructions.

### Milestone 2: Full dashboard mobile adaptation

Includes:

- Projects and pipeline.
- Inventory and Ideas.
- Docs, Links, News, Memory, and Chats.
- Activity, Usage, Health.
- Benchmarks and Evaluations.
- Remaining tables, charts, drawers, and filters.
- Final release APK checklist.

## 16. Acceptance criteria

Milestone 1 is accepted when:

- A debug APK installs and opens on the Pixel 9.
- The app can save and test a Tailscale HTTPS server URL.
- Home and the daily-use views load real backend data both at home and over cellular with Tailscale connected.
- Every Milestone 1 action works without page-level horizontal scrolling.
- Touch targets and text remain usable at a 360px-wide viewport.
- Android back closes overlays and navigates predictably.
- An unreachable backend produces a recoverable error state rather than a blank screen.
- The existing desktop interface remains operational.
- No Express port is exposed directly to the public internet.

Milestone 2 is accepted when every existing sidebar destination is usable from the mobile More sheet and each screen has a deliberate phone layout rather than a scaled desktop layout.

## 17. Implementation boundary

Implementation must follow the existing project patterns and avoid unrelated refactors. Large files may be split only where necessary to isolate mobile shell, API transport, connection state, or reusable responsive components. Desktop behavior and the existing visual identity remain regression requirements throughout the work.
