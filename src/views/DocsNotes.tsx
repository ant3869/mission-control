import { BookOpen, Link2, NotebookPen } from 'lucide-react'
import { TabHub, type HubTab } from '../components/layout/TabHub'
import { Docs } from './Docs'
import { Notes } from './Notes'
import { Links } from './Links'

export function DocsNotes() {
  const tabs: HubTab[] = [
    { id: 'docs',  label: 'Docs',  icon: <BookOpen    size={13} />, render: () => <Docs /> },
    { id: 'notes', label: 'Notes', icon: <NotebookPen size={13} />, render: () => <Notes /> },
    { id: 'links', label: 'Links', icon: <Link2       size={13} />, render: () => <Links /> },
  ]
  return <TabHub view="docs" tabs={tabs} />
}
