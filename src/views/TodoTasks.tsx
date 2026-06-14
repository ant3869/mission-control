// title: TodoTasks — combined personal To-Do + work Tasks page
// path: src/views/TodoTasks.tsx
// purpose: One page (nav id 'todos') with a view switcher. To-Do (personal
//          quick-capture list) is the default; "Tasks" flips to the kanban board
//          from the old Tasks page. Approvals and Inbox (formerly the Tasks page)
//          ride along as the remaining tabs so nothing was lost in the merge.

import { ListTodo, CheckSquare, ThumbsUp, Inbox as InboxIcon } from 'lucide-react'
import { TabHub } from '../components/layout/TabHub'
import Todos from './Todos'
import { Tasks } from './Tasks'
import { Approvals } from './Approvals'
import { Inbox } from './Inbox'

export function TodoTasks() {
  return (
    <TabHub
      view="todos"
      tabs={[
        { id: 'todo',      label: 'To-Do',     icon: <ListTodo    size={13} />, render: () => <Todos /> },
        { id: 'tasks',     label: 'Tasks',     icon: <CheckSquare size={13} />, render: () => <Tasks /> },
        { id: 'approvals', label: 'Approvals', icon: <ThumbsUp    size={13} />, render: () => <Approvals /> },
        { id: 'inbox',     label: 'Inbox',     icon: <InboxIcon   size={13} />, render: () => <Inbox /> },
      ]}
    />
  )
}
