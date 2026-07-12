import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BookOpen,
  Brain,
  Calendar,
  Cog,
  FlaskConical,
  FolderKanban,
  HeartPulse,
  House,
  Lightbulb,
  Link,
  ListTodo,
  MessageSquare,
  Newspaper,
  Package,
  Radar,
  ShoppingCart,
  Target,
  Wallet,
} from 'lucide-react'
import type { View } from '../../types'

export type NavItem = { id: View; label: string; Icon: LucideIcon }
export type NavSection = { label: string; items: NavItem[] }

export const VIEW_TITLES: Record<View, string> = {
  home:        'Home',
  todos:       'To-Do',
  tobuy:       'To-Buy',
  spend:       'Financials',
  council:     'Chats',
  calendar:    'Scheduled Tasks',
  docs:        'Docs & Notes',
  links:       'Links',
  news:        'News',
  memory:      'Memory',
  projects:    'Projects & Pipeline',
  inventory:   'Inventory',
  factory:     'Idea Factory',
  activity:    'Activity',
  usage:       'Usage',
  harness:     'Harness Benchmarks',
  evaluations: 'Evaluations',
  health:      'Health',
  settings:    'Settings',
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Work',
    items: [
      { id: 'home',     label: 'Home',       Icon: House },
      { id: 'todos',    label: 'To-Do',      Icon: ListTodo },
      { id: 'tobuy',    label: 'To-Buy',     Icon: ShoppingCart },
      { id: 'spend',    label: 'Financials', Icon: Wallet },
      { id: 'council',  label: 'Chats',      Icon: MessageSquare },
      { id: 'calendar', label: 'Calendar',   Icon: Calendar },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'docs',   label: 'Docs',   Icon: BookOpen },
      { id: 'links',  label: 'Links',  Icon: Link },
      { id: 'news',   label: 'News',   Icon: Newspaper },
      { id: 'memory', label: 'Memory', Icon: Brain },
    ],
  },
  {
    label: 'Build',
    items: [
      { id: 'projects',  label: 'Projects',  Icon: FolderKanban },
      { id: 'inventory', label: 'Inventory', Icon: Package },
      { id: 'factory',   label: 'Ideas',     Icon: Lightbulb },
    ],
  },
  {
    label: 'AI Ops',
    items: [
      { id: 'activity',    label: 'Activity',   Icon: Activity },
      { id: 'usage',       label: 'Usage',      Icon: Radar },
      { id: 'harness',     label: 'Benchmarks', Icon: FlaskConical },
      { id: 'evaluations', label: 'Evals',      Icon: Target },
      { id: 'health',      label: 'Health',     Icon: HeartPulse },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'settings', label: 'Settings', Icon: Cog },
    ],
  },
]

export const BOTTOM_NAV: View[] = ['home', 'todos', 'calendar', 'activity']
