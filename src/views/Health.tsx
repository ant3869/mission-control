// title: Health — consolidated platform & connector health
// path: src/views/Health.tsx
// purpose: Merges System (Claude config/MCP health), Security (connector posture),
//          Alerts (rules over the event store) and the per-platform OpenClaw /
//          Hermes deep-dive dashboards into one operational health hub.

import { Settings, Shield, Bell, Activity as ActivityIcon, Gauge } from 'lucide-react'
import { TabHub } from '../components/layout/TabHub'
import { System } from './System'
import { OpenClawMetrics, HermesMetrics } from './PlatformMetrics'
import { requestNavigate } from '../lib/quickActions'
import Security from './Security'
import Alerts from './Alerts'

export function Health() {
  return (
    <TabHub
      view="health"
      tabs={[
        { id: 'system',   label: 'System',   icon: <Settings     size={13} />, render: () => <System /> },
        { id: 'security', label: 'Security', icon: <Shield       size={13} />, render: () => <Security /> },
        { id: 'alerts',   label: 'Alerts',   icon: <Bell         size={13} />, render: () => <Alerts /> },
        { id: 'openclaw', label: 'OpenClaw', icon: <ActivityIcon size={13} />, render: () => <OpenClawMetrics onNavigate={requestNavigate} /> },
        { id: 'hermes',   label: 'Hermes',   icon: <Gauge        size={13} />, render: () => <HermesMetrics onNavigate={requestNavigate} /> },
      ]}
    />
  )
}
