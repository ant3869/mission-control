import { useState } from 'react'
import { clsx } from 'clsx'
import { Search, Mail, Phone, Globe, Plus, Tag } from 'lucide-react'
import { people } from '../data/mockData'
import type { Person, PersonType } from '../types'

const typeConfig: Record<PersonType, { label: string; color: string }> = {
  collaborator: { label: 'Collaborator', color: 'text-teal-400 bg-teal-950/40 border-teal-900/50'    },
  client:       { label: 'Client',       color: 'text-violet-400 bg-violet-950/40 border-violet-900/50' },
  contact:      { label: 'Contact',      color: 'text-blue-400 bg-blue-950/40 border-blue-900/50'    },
  vendor:       { label: 'Vendor',       color: 'text-amber-400 bg-amber-950/40 border-amber-900/50'  },
}

const TYPES: PersonType[] = ['collaborator', 'client', 'contact', 'vendor']

type FilterType = PersonType | 'all'

function PersonCard({ person, onDelete }: { person: Person, onDelete: (id: string) => void }) {
  const tc = typeConfig[person.type]
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:border-border-strong transition-all relative">
      {/* Top */}
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold bg-gradient-to-br shrink-0',
          person.avatarColor,
        )}>
          {person.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary leading-tight">{person.name}</p>
            <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', tc.color)}>
              {tc.label}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            {person.role}{person.company ? ` · ${person.company}` : ''}
          </p>
        </div>
        {/* Delete button */}
        <button
          aria-label="Delete contact"
          title="Delete contact"
          onClick={() => onDelete(person.id)}
          className="ml-2 p-1 rounded hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
          style={{ lineHeight: 0 }}
        >
          {/* Trash icon from lucide-react */}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6h16zm5 0v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6h16z" /></svg>
        </button>
      </div>

      {/* Contact */}
      <div className="flex flex-col gap-1">
        {person.email && (
          <a href={`mailto:${person.email}`} className="flex items-center gap-1.5 text-xxs text-text-muted hover:text-text-secondary transition-colors group">
            <Mail size={11} className="shrink-0" />
            <span className="truncate group-hover:text-accent-blue">{person.email}</span>
          </a>
        )}
        {person.phone && (
          <div className="flex items-center gap-1.5 text-xxs text-text-muted">
            <Phone size={11} className="shrink-0" />
            <span>{person.phone}</span>
          </div>
        )}
        {person.url && (
          <a href={person.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xxs text-text-muted hover:text-text-secondary transition-colors">
            <Globe size={11} className="shrink-0" />
            <span className="truncate hover:text-accent-blue">Profile</span>
          </a>
        )}
      </div>

      {/* Notes */}
      {person.notes && (
        <p className="text-xxs text-text-muted leading-relaxed border-t border-border-subtle pt-2.5">
          {person.notes}
        </p>
      )}

      {/* Tags */}
      {person.tags && person.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {person.tags.map(t => (
            <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">
              <Tag size={8} />
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      {person.lastContact && (
        <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
          <span className="text-xxs text-text-muted">Last contact</span>
          <span className="text-xxs text-text-secondary">{person.lastContact}</span>
        </div>
      )}
    </div>
  )
}

export function People() {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const [contactList, setContactList] = useState<Person[]>(people)
  const [showAdd, setShowAdd] = useState(false)
  const [newPerson, setNewPerson] = useState<Partial<Person>>({ type: 'collaborator' })

  const filtered = contactList.filter(p => {
    const matchType = typeFilter === 'all' || p.type === typeFilter
    const q = query.toLowerCase()
    const matchQuery = !q
      || p.name.toLowerCase().includes(q)
      || p.role.toLowerCase().includes(q)
      || (p.company ?? '').toLowerCase().includes(q)
      || (p.email ?? '').toLowerCase().includes(q)
      || (p.tags ?? []).some(t => t.includes(q))
    return matchType && matchQuery
  })

  const counts = Object.fromEntries(
    TYPES.map(t => [t, contactList.filter(p => p.type === t).length])
  ) as Record<PersonType, number>

  const handleDelete = (id: string) => {
    setContactList(list => list.filter(p => p.id !== id))
  }

  const handleAddPerson = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPerson.name || !newPerson.role || !newPerson.type) return
    const initials = newPerson.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
    const avatarColor = 'from-teal-500 to-cyan-600'
    setContactList(list => [
      {
        ...newPerson,
        id: 'p-' + (Date.now()),
        initials,
        avatarColor,
      } as Person,
      ...list
    ])
    setShowAdd(false)
    setNewPerson({ type: 'collaborator' })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Add Person Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <form onSubmit={handleAddPerson} className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Add Person</h2>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <input
                className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
                placeholder="Name"
                value={newPerson.name || ''}
                onChange={e => setNewPerson(p => ({ ...p, name: e.target.value }))}
                required
                autoFocus
              />
              <input
                className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
                placeholder="Role"
                value={newPerson.role || ''}
                onChange={e => setNewPerson(p => ({ ...p, role: e.target.value }))}
                required
              />
              <input
                className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
                placeholder="Company (optional)"
                value={newPerson.company || ''}
                onChange={e => setNewPerson(p => ({ ...p, company: e.target.value }))}
              />
              <input
                className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
                placeholder="Email (optional)"
                value={newPerson.email || ''}
                onChange={e => setNewPerson(p => ({ ...p, email: e.target.value }))}
                type="email"
              />
              <select
                className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary focus:outline-none focus:border-blue-500/60 transition-colors"
                value={newPerson.type || 'collaborator'}
                onChange={e => setNewPerson(p => ({ ...p, type: e.target.value as PersonType }))}
                required
              >
                {TYPES.map(t => <option key={t} value={t}>{typeConfig[t].label}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button type="button" className="px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors">Add</button>
            </div>
          </form>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">People</h1>
          <p className="text-xs text-text-muted mt-0.5">{contactList.length} contacts tracked</p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={13} />Add Person
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search people…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 rounded border border-border bg-card text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* Type tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTypeFilter('all')}
            className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all',
              typeFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
          >
            All <span className="ml-1 text-xxs opacity-60">{contactList.length}</span>
          </button>
          {TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t === typeFilter ? 'all' : t)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all capitalize',
                typeFilter === t ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
            >
              {typeConfig[t].label} <span className="ml-1 text-xxs opacity-60">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Search size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">No people match</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(p => <PersonCard key={p.id} person={p} onDelete={handleDelete} />)}
          </div>
        )}
      </div>
    </div>
  )
}
