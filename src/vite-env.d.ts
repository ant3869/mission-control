/// <reference types="vite/client" />

declare module 'lucide-react' {
  import { FC, SVGProps } from 'react'
  export interface IconProps extends SVGProps<SVGSVGElement> {
    size?: number | string
    strokeWidth?: number | string
    color?: string
    absoluteStrokeWidth?: boolean
  }
  export type Icon = FC<IconProps>
  export const CheckSquare: Icon
  export const Bot: Icon
  export const FileText: Icon
  export const ThumbsUp: Icon
  export const Users: Icon
  export const Calendar: Icon
  export const FolderKanban: Icon
  export const Brain: Icon
  export const BookOpen: Icon
  export const UserCircle: Icon
  export const Building2: Icon
  export const Network: Icon
  export const Settings: Icon
  export const Radar: Icon
  export const Factory: Icon
  export const GitBranch: Icon
  export const MessageSquare: Icon
  export const ChevronRight: Icon
  export const Search: Icon
  export const Pause: Icon
  export const Bell: Icon
  export const Zap: Icon
  export const Clock: Icon
  export const Construction: Icon
  export const Plus: Icon
  export const MoreHorizontal: Icon
  export const TrendingUp: Icon
  export const User: Icon
  export const FolderOpen: Icon
  export const Tag: Icon
  export const Eye: Icon
  export const ChevronDown: Icon
  export const Circle: Icon
  export const ArrowUpRight: Icon
  export const Hash: Icon
  export const Edit3: Icon
  export const Trash2: Icon
  export const Activity: Icon
  export const BarChart2: Icon
  export const Link: Icon
  export const X: Icon
  export const Flame: Icon
  export const BookOpen: Icon
  export const AlertCircle: Icon
  export const Cpu: Icon
  export const DollarSign: Icon
  export const Sliders: Icon
  export const CheckCircle2: Icon
  export const WifiOff: Icon
  export const AlertTriangle: Icon
  export const RefreshCw: Icon
  export const Power: Icon
  export const Play: Icon
  export const Loader: Icon
  export const Circle: Icon
  export const XCircle: Icon
  export const ToggleLeft: Icon
  export const ToggleRight: Icon
  export const Timer: Icon
  export const BarChart2: Icon
  export const Youtube: Icon
  export const Mail: Icon
  export const Twitter: Icon
  export const Linkedin: Icon
  export const GitMerge: Icon
  export const ShoppingCart: Icon
  export const Upload: Icon
  export const Check: Icon
  export const Send: Icon
  export const Target: Icon
  export const Phone: Icon
  export const Globe: Icon
  export const Tag: Icon
  export const Star: Icon
  export const ThumbsDown: Icon
  export const Filter: Icon
  export const Link2: Icon
  export const Key: Icon
  export const Cloud: Icon
}

declare module 'date-fns' {
  export function format(date: Date, formatStr: string): string
  export function startOfWeek(date: Date, options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }): Date
  export function addDays(date: Date, amount: number): Date
  export function isToday(date: Date): boolean
}
