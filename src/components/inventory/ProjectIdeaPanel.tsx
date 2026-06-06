import React from 'react';
import { ProjectIdea } from '../../lib/api';
import { X, Package, Wrench, DollarSign, Clock, ChevronRight, Star, Zap, ThumbsUp } from 'lucide-react';

interface ProjectIdeaPanelProps {
  idea: ProjectIdea | null;
  onClose: () => void;
  onSave?: (id: string) => void;
  onReject?: (id: string, reason: string) => void;
  onSnooze?: (id: string) => void;
  onComplete?: (id: string) => void;
}

function ScoreBar({ label, value, max = 10, color = 'blue' }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
  };
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorMap[color] ?? 'bg-blue-500'} rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ProjectIdeaPanel({ idea, onClose, onSave, onReject, onSnooze, onComplete }: ProjectIdeaPanelProps) {
  const [showRejectInput, setShowRejectInput] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');

  React.useEffect(() => {
    setShowRejectInput(false);
    setRejectReason('');
  }, [idea?.id]);

  if (!idea) return null;

  const influence = idea.influenceMetadata ?? {};
  const haveParts: string[] = Array.isArray(idea.haveParts) ? idea.haveParts : [];
  const missingParts: string[] = Array.isArray(idea.missingParts) ? idea.missingParts : [];
  const tools: string[] = Array.isArray(idea.requiredTools) ? idea.requiredTools : [];

  const handleReject = () => {
    if (showRejectInput) {
      onReject?.(idea.id, rejectReason);
      setShowRejectInput(false);
      setRejectReason('');
    } else {
      setShowRejectInput(true);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-gray-900 border-l border-gray-700 flex flex-col z-50 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-gray-700 flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <h2 className="text-lg font-semibold text-white leading-tight">{idea.title}</h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {idea.category && (
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{idea.category}</span>
            )}
            {idea.difficulty && (
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{idea.difficulty}</span>
            )}
            {idea.status && (
              <span className={`text-xs px-2 py-0.5 rounded capitalize ${
                idea.status === 'liked' ? 'bg-green-900 text-green-300' :
                idea.status === 'rejected' ? 'bg-red-900 text-red-300' :
                idea.status === 'snoozed' ? 'bg-yellow-900 text-yellow-300' :
                idea.status === 'completed' ? 'bg-blue-900 text-blue-300' :
                'bg-gray-700 text-gray-300'
              }`}>{idea.status}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white flex-shrink-0 p-1">
          <X size={20} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">

        {/* Description */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Description</h3>
          <p className="text-gray-200 leading-relaxed">{idea.description}</p>
        </div>

        {/* Why it fits */}
        {idea.whyFit && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Why It Fits Your Inventory</h3>
            <p className="text-gray-200 leading-relaxed">{idea.whyFit}</p>
          </div>
        )}

        {/* Parts */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Package size={12} /> Have ({haveParts.length})
            </h3>
            {haveParts.length > 0 ? (
              <ul className="space-y-1">
                {haveParts.map((p, i) => (
                  <li key={i} className="text-gray-300 text-xs flex items-start gap-1">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>{p}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-gray-500 text-xs">None listed</span>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Package size={12} /> Missing ({missingParts.length})
            </h3>
            {missingParts.length > 0 ? (
              <ul className="space-y-1">
                {missingParts.map((p, i) => (
                  <li key={i} className="text-gray-300 text-xs flex items-start gap-1">
                    <span className="text-yellow-500 mt-0.5 flex-shrink-0">○</span>{p}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-gray-500 text-xs">None needed</span>
            )}
          </div>
        </div>

        {/* Estimates */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Estimates</h3>
          <div className="grid grid-cols-3 gap-2">
            {idea.costEstimate != null && (
              <div className="bg-gray-800 rounded p-2 text-center">
                <DollarSign size={14} className="text-green-400 mx-auto mb-1" />
                <div className="text-white font-medium text-sm">{idea.costEstimate}</div>
                <div className="text-gray-500 text-xs">Cost</div>
              </div>
            )}
            {idea.timeEstimate && (
              <div className="bg-gray-800 rounded p-2 text-center">
                <Clock size={14} className="text-blue-400 mx-auto mb-1" />
                <div className="text-white font-medium text-sm">{idea.timeEstimate}</div>
                <div className="text-gray-500 text-xs">Time</div>
              </div>
            )}
            {idea.difficulty && (
              <div className="bg-gray-800 rounded p-2 text-center">
                <Wrench size={14} className="text-orange-400 mx-auto mb-1" />
                <div className="text-white font-medium text-sm capitalize">{idea.difficulty}</div>
                <div className="text-gray-500 text-xs">Difficulty</div>
              </div>
            )}
          </div>
        </div>

        {/* Scores */}
        {(idea.confidence != null || idea.coolness != null || idea.usefulnessScore != null) && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Scores</h3>
            <div className="space-y-2.5">
              {idea.confidence != null && <ScoreBar label="Confidence" value={idea.confidence} color="blue" />}
              {idea.coolness != null && <ScoreBar label="Coolness" value={idea.coolness} color="purple" />}
              {idea.usefulnessScore != null && <ScoreBar label="Usefulness" value={idea.usefulnessScore} color="green" />}
            </div>
          </div>
        )}

        {/* Tools */}
        {tools.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tools &amp; Skills</h3>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t, i) => (
                <span key={i} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded border border-gray-700">{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Next step */}
        {idea.nextStep && (
          <div className="bg-blue-900/30 border border-blue-800/50 rounded p-3">
            <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <ChevronRight size={12} /> Suggested Next Step
            </h3>
            <p className="text-gray-200 text-sm">{idea.nextStep}</p>
          </div>
        )}

        {/* Why this was suggested */}
        {(influence.inventoryFactors?.length ||
          influence.matchedCategories?.length ||
          influence.priorLikedInfluence?.length ||
          influence.priorRejectedInfluence?.length ||
          influence.rejectionNotes?.length ||
          influence.preferenceSignals?.length ||
          influence.contextualFactors?.length) ? (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Why This Was Suggested</h3>
            <div className="space-y-3 bg-gray-800/50 rounded p-3 border border-gray-700">
              {influence.inventoryFactors && influence.inventoryFactors.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Inventory factors</div>
                  <ul className="space-y-0.5">
                    {influence.inventoryFactors.map((f, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>{f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {influence.matchedCategories && influence.matchedCategories.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Matched categories</div>
                  <div className="flex flex-wrap gap-1">
                    {influence.matchedCategories.map((c, i) => (
                      <span key={i} className="text-xs bg-gray-700 text-blue-300 px-2 py-0.5 rounded">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {influence.priorLikedInfluence && influence.priorLikedInfluence.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <ThumbsUp size={10} className="text-green-400" /> Influenced by saved ideas
                  </div>
                  <ul className="space-y-0.5">
                    {influence.priorLikedInfluence.map((l, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <span className="text-green-400 mt-0.5 flex-shrink-0">+</span>{l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {((influence.priorRejectedInfluence?.length ?? 0) > 0 || (influence.rejectionNotes?.length ?? 0) > 0) && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Shaped by rejection feedback</div>
                  <ul className="space-y-0.5">
                    {[...(influence.priorRejectedInfluence ?? []), ...(influence.rejectionNotes ?? [])].map((r, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <span className="text-red-400 mt-0.5 flex-shrink-0">−</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {influence.preferenceSignals && influence.preferenceSignals.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">User preference signals</div>
                  <ul className="space-y-0.5">
                    {influence.preferenceSignals.map((s, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <Star size={10} className="text-yellow-400 mt-0.5 flex-shrink-0" />{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {influence.contextualFactors && influence.contextualFactors.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Contextual factors</div>
                  <ul className="space-y-0.5">
                    {influence.contextualFactors.map((f, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <Zap size={10} className="text-yellow-300 mt-0.5 flex-shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Rejection reason */}
        {idea.status === 'rejected' && idea.rejectionReason && (
          <div className="bg-red-900/20 border border-red-800/40 rounded p-3">
            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Rejection Reason</h3>
            <p className="text-gray-300 text-xs">{idea.rejectionReason}</p>
          </div>
        )}

        {/* Status history */}
        {idea.statusHistory && idea.statusHistory.length > 1 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Status History</h3>
            <div className="space-y-1.5">
              {idea.statusHistory.map((entry, i) => (
                <div key={i} className="flex items-baseline gap-2 text-xs">
                  <span className="text-gray-500 whitespace-nowrap flex-shrink-0">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </span>
                  <span className="text-gray-300 capitalize">{entry.status}</span>
                  {entry.note && <span className="text-gray-500">— {entry.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
        {showRejectInput && (
          <div className="flex gap-2">
            <input
              type="text"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Why are you rejecting this?"
              className="flex-1 bg-gray-800 border border-gray-600 text-white text-sm rounded px-3 py-1.5 placeholder-gray-500 focus:outline-none focus:border-red-500"
              onKeyDown={e => { if (e.key === 'Enter') handleReject(); }}
              autoFocus
            />
            <button
              onClick={() => setShowRejectInput(false)}
              className="text-gray-400 hover:text-white px-2 text-sm"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-2">
          {idea.status !== 'liked' && (
            <button
              onClick={() => onSave?.(idea.id)}
              className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              Save
            </button>
          )}
          {idea.status !== 'snoozed' && (
            <button
              onClick={() => onSnooze?.(idea.id)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              Snooze
            </button>
          )}
          {idea.status !== 'rejected' && (
            <button
              onClick={handleReject}
              className="flex-1 bg-red-800 hover:bg-red-700 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              {showRejectInput ? 'Confirm Reject' : 'Reject'}
            </button>
          )}
          {idea.status !== 'completed' && (
            <button
              onClick={() => onComplete?.(idea.id)}
              className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
