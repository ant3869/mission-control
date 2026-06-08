// title: View error boundary
// path: src/components/ErrorBoundary.tsx
// purpose: Isolate runtime errors to a single view. Without this, an exception in
//          any view white-screens the whole dashboard (sidebar, top bar, other
//          views included). Wrapping each view pane means a crash shows a
//          recoverable fallback while the rest of the app keeps working.

import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
        <AlertTriangle size={28} className="text-amber-400" />
        <p className="text-sm font-semibold text-text-primary">
          {this.props.label ? `The ${this.props.label} view hit an error` : 'This view hit an error'}
        </p>
        <p className="text-xs text-text-muted max-w-md font-mono break-words">{this.state.error.message}</p>
        <button
          onClick={this.reset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium"
        >
          <RefreshCw size={13} /> Try again
        </button>
        <p className="text-[10px] text-text-muted opacity-60">The rest of the dashboard is unaffected — switch views from the sidebar.</p>
      </div>
    )
  }
}
