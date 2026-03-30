import { Construction } from 'lucide-react'

interface ComingSoonProps {
  view: string
}

export function ComingSoon({ view }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-card border border-border">
        <Construction size={18} className="text-text-muted" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-secondary capitalize">{view}</p>
        <p className="text-xs text-text-muted mt-0.5">Coming next iteration</p>
      </div>
    </div>
  )
}
