import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, Pause, Play, RefreshCw, RotateCcw, ShieldQuestion, Square } from 'lucide-react'
import { agentCron, approvals, harnessBench, metrics, type AgentCronJob, type ConnectorId, type CronAction, type HbRun, type MetricSessionRow } from '../lib/api'
import { buildSessionApproval } from '../lib/controlActions'
import { friendlyError } from '../lib/friendlyError'

type Sourced<T> = T & { source: ConnectorId }

export function Controls() {
  const [jobs, setJobs] = useState<Array<Sourced<AgentCronJob>>>([])
  const [runs, setRuns] = useState<HbRun[]>([])
  const [sessions, setSessions] = useState<Array<Sourced<MetricSessionRow>>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setNotice('')
    const [ocCron, heCron, runData, ocMetrics, heMetrics] = await Promise.allSettled([agentCron.openclaw(), agentCron.hermes(), harnessBench.runs(), metrics.openclaw(), metrics.hermes()])
    setJobs([
      ...(ocCron.status === 'fulfilled' ? ocCron.value.jobs.map((job) => ({ ...job, source: 'openclaw' as const })) : []),
      ...(heCron.status === 'fulfilled' ? heCron.value.jobs.map((job) => ({ ...job, source: 'hermes' as const })) : []),
    ])
    setRuns(runData.status === 'fulfilled' ? runData.value.runs.slice(0, 12) : [])
    setSessions([
      ...(ocMetrics.status === 'fulfilled' ? ocMetrics.value.metrics.sessionList.map((session) => ({ ...session, source: 'openclaw' as const })) : []),
      ...(heMetrics.status === 'fulfilled' ? heMetrics.value.metrics.sessionList.map((session) => ({ ...session, source: 'hermes' as const })) : []),
    ].slice(0, 20))
    if ([ocCron, heCron, runData, ocMetrics, heMetrics].every((result) => result.status === 'rejected')) setNotice('Control data is currently unavailable.')
    setLoading(false)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const act = async (key: string, operation: () => Promise<unknown>, success: string) => {
    setBusy(key); setNotice('')
    try { await operation(); setNotice(success); await refresh() }
    catch (cause) { setNotice(friendlyError(cause, 'Control action failed.')) }
    finally { setBusy('') }
  }
  const cronAction = (job: Sourced<AgentCronJob>, action: CronAction) => act(`cron-${job.id}-${action}`, () => agentCron.action(job.source, job.id, action), `${job.name} ${action} request completed.`)

  return <div className="h-full overflow-y-auto p-5">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">Activity controls</h2><p className="text-xs text-text-muted">Operate schedules, benchmark runs, and session escalations from one place.</p></div><button onClick={() => void refresh()} className="flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1.5 text-xs text-text-secondary hover:bg-card-hover"><RefreshCw size={13} />Refresh</button></div>
    {notice && <p className="mb-3 flex items-center gap-2 rounded border border-border bg-card p-2.5 text-xs text-text-secondary"><AlertCircle size={13} />{notice}</p>}
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 size={18} className="animate-spin text-text-muted" /></div> : <div className="grid gap-4 xl:grid-cols-3">
      <ControlSection title={`Schedules · ${jobs.length}`} empty="No reachable scheduled jobs.">{jobs.map((job) => <ControlRow key={`${job.source}-${job.id}`} title={job.name} detail={`${job.source} · ${job.schedule}`}><Action disabled={Boolean(busy)} onClick={() => void cronAction(job, job.enabled ? 'pause' : 'resume')} icon={job.enabled ? <Pause size={12} /> : <Play size={12} />} label={job.enabled ? 'Pause' : 'Resume'} /><Action disabled={Boolean(busy)} onClick={() => void cronAction(job, 'trigger')} icon={<Play size={12} />} label="Run" /></ControlRow>)}</ControlSection>
      <ControlSection title={`Benchmark runs · ${runs.length}`} empty="No benchmark runs.">{runs.map((run) => <ControlRow key={run.id} title={`${run.taskPackName} · ${run.modelName}`} detail={`${run.harness} · ${run.status} · ${run.completedCount}/${run.taskCount}`}>{['queued','running'].includes(run.status) && <Action disabled={Boolean(busy)} onClick={() => void act(`cancel-${run.id}`, () => harnessBench.cancel(run.id), 'Cancellation requested.')} icon={<Square size={12} />} label="Cancel" />}{(run.status === 'failed' || run.failureCount > 0) && <Action disabled={Boolean(busy)} onClick={() => void act(`retry-${run.id}`, () => harnessBench.rerunFailed(run.id), 'Failed tasks queued again.')} icon={<RotateCcw size={12} />} label="Retry" />}</ControlRow>)}</ControlSection>
      <ControlSection title={`Sessions · ${sessions.length}`} empty="No live sessions.">{sessions.map((session) => <ControlRow key={`${session.source}-${session.key}`} title={session.title || session.key} detail={`${session.source} · ${session.status} · ${session.model || 'unknown model'}`}><Action disabled={Boolean(busy)} onClick={() => void act(`escalate-${session.source}-${session.key}`, () => approvals.create(buildSessionApproval(session.source, session)), 'Approval created.')} icon={<ShieldQuestion size={12} />} label="Escalate" /></ControlRow>)}</ControlSection>
    </div>}
  </div>
}

function ControlSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section className="rounded-lg border border-border bg-card"><h3 className="border-b border-border px-3 py-2 text-xs font-semibold text-text-primary">{title}</h3><div className="divide-y divide-border">{hasChildren ? children : <p className="p-4 text-xs text-text-muted">{empty}</p>}</div></section> }
function ControlRow({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="p-3"><p className="truncate text-xs font-medium text-text-primary">{title}</p><p className="mt-0.5 truncate text-[10px] text-text-muted">{detail}</p><div className="mt-2 flex gap-1.5">{children}</div></div> }
function Action({ disabled, onClick, icon, label }: { disabled: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button disabled={disabled} onClick={onClick} className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-card-hover disabled:opacity-40">{icon}{label}</button> }
