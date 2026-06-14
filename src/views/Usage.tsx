// title: Usage — consolidated cost & model analytics
// path: src/views/Usage.tsx
// purpose: Merges the former Radar (Claude Code token/cost/heatmap) and Model
//          Ops (cross-platform model analytics) views, which heavily overlapped,
//          into one "what am I spending / which models" hub.

import { Radar as RadarIcon, BarChart3 } from 'lucide-react'
import { TabHub } from '../components/layout/TabHub'
import { Radar } from './Radar'
import { ModelOps } from './ModelOps'

export function Usage() {
  return (
    <TabHub
      view="usage"
      tabs={[
        { id: 'radar',  label: 'Usage',  icon: <RadarIcon size={13} />, render: () => <Radar /> },
        { id: 'models', label: 'Models', icon: <BarChart3 size={13} />, render: () => <ModelOps /> },
      ]}
    />
  )
}
