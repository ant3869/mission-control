import { FolderKanban, GitBranch } from 'lucide-react'
import { TabHub, type HubTab } from '../components/layout/TabHub'
import { Projects } from './Projects'
import { Pipeline } from './Pipeline'

export function ProjectsPipeline() {
  const tabs: HubTab[] = [
    { id: 'projects', label: 'Projects', icon: <FolderKanban size={13} />, render: () => <Projects /> },
    { id: 'pipeline', label: 'Pipeline', icon: <GitBranch    size={13} />, render: () => <Pipeline /> },
  ]
  return <TabHub view="projects" tabs={tabs} />
}
