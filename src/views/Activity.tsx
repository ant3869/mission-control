// title: Activity — consolidated live agent telemetry
// path: src/views/Activity.tsx
// purpose: One home for cross-platform agent monitoring, merging the former
//          Watch, Flow, Brain, Agents and Flow Map views (all derived from the
//          same OpenClaw/Hermes/Claude event wells) into tabs.

import { Radio, GitBranch, BrainCircuit, Bot, Workflow } from 'lucide-react'
import { TabHub } from '../components/layout/TabHub'
import { Watch } from './Watch'
import { Agents } from './Agents'
import { FlowMap } from './FlowMap'
import Brain from './Brain'
import Flow from './Flow'

export function Activity() {
  return (
    <TabHub
      view="activity"
      tabs={[
        { id: 'live',     label: 'Live',     icon: <Radio       size={13} />, render: () => <Watch /> },
        { id: 'sessions', label: 'Sessions', icon: <GitBranch   size={13} />, render: () => <Flow /> },
        { id: 'brain',    label: 'Brain',    icon: <BrainCircuit size={13} />, render: () => <Brain /> },
        { id: 'agents',   label: 'Agents',   icon: <Bot         size={13} />, render: () => <Agents /> },
        { id: 'map',      label: 'Map',      icon: <Workflow    size={13} />, render: () => <FlowMap /> },
      ]}
    />
  )
}
