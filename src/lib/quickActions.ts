import type { View } from '../types'
import { notes } from './api'

export type DocsTabId = 'docs' | 'notes' | 'links'
export type TasksTabId = 'tasks' | 'approvals' | 'inbox'

export const NAVIGATE_EVENT = 'mc:navigate'
export const HUB_TAB_EVENT = 'mc:hub-tab'
export const DOCS_TAB_EVENT = 'mc:docs-tab'
export const NOTES_PAGE_EVENT = 'mc:notes-page'
export const DOCS_FILE_EVENT = 'mc:docs-file'
export const TASK_FOCUS_EVENT = 'mc:task-focus'
export const APPROVAL_FOCUS_EVENT = 'mc:approval-focus'
export const INBOX_ITEM_EVENT = 'mc:inbox-item'
export const DOCS_TAB_STORAGE_KEY = 'mc:docs:tab'
export const NOTES_PAGE_STORAGE_KEY = 'mc:notes:page'
export const DOCS_FILE_STORAGE_KEY = 'mc:docs:file'
export const TASK_FOCUS_STORAGE_KEY = 'mc:tasks:focus'
export const APPROVAL_FOCUS_STORAGE_KEY = 'mc:approvals:focus'
export const INBOX_ITEM_STORAGE_KEY = 'mc:inbox:item'

function storeValue(key: string, value: string): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

export function readStoredValue(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' && parsed ? parsed : null
  } catch {
    return null
  }
}

export function clearStoredValue(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

export function requestNavigate(view: View): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view } }))
}

// ── Consolidated hub tab targeting ──────────────────────────────────────────
// Lets a deep-link (e.g. Home → "system error") navigate to a tab-hub view AND
// land on the right inner tab. Each hub stores its tab under a per-view key and
// listens for HUB_TAB_EVENT (matching its own view) to switch while mounted.
export function hubTabStorageKey(view: View): string {
  return `mc:hub:${view}:tab`
}

export function readHubTab(view: View): string | null {
  return readStoredValue(hubTabStorageKey(view))
}

export function writeHubTab(view: View, tab: string): void {
  storeValue(hubTabStorageKey(view), tab)
}

/** Navigate to a hub view and select one of its inner tabs. */
export function openHubTab(view: View, tab: string): void {
  storeValue(hubTabStorageKey(view), tab)
  requestNavigate(view)
  window.dispatchEvent(new CustomEvent(HUB_TAB_EVENT, { detail: { view, tab } }))
}

export function openDocsTab(tab: DocsTabId): void {
  try { localStorage.setItem(DOCS_TAB_STORAGE_KEY, JSON.stringify(tab)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(DOCS_TAB_EVENT, { detail: { tab } }))
}

// To-Do, Tasks, Approvals and Inbox are now tabs of one combined page (view
// 'todos'); this routes the old tasks-tab deep-links onto that hub.
export function openTasksTab(tab: TasksTabId): void {
  openHubTab('todos', tab)
}

export function openNotePage(pageId: string): void {
  storeValue(NOTES_PAGE_STORAGE_KEY, pageId)
  window.dispatchEvent(new CustomEvent(NOTES_PAGE_EVENT, { detail: { pageId } }))
}

export function openDocFile(fileId: string): void {
  storeValue(DOCS_FILE_STORAGE_KEY, fileId)
  window.dispatchEvent(new CustomEvent(DOCS_FILE_EVENT, { detail: { fileId } }))
}

export function focusTaskCard(taskId: string): void {
  storeValue(TASK_FOCUS_STORAGE_KEY, taskId)
  window.dispatchEvent(new CustomEvent(TASK_FOCUS_EVENT, { detail: { taskId } }))
}

export function focusApprovalRequest(approvalId: string): void {
  storeValue(APPROVAL_FOCUS_STORAGE_KEY, approvalId)
  window.dispatchEvent(new CustomEvent(APPROVAL_FOCUS_EVENT, { detail: { approvalId } }))
}

export function openInboxItem(itemId: string): void {
  storeValue(INBOX_ITEM_STORAGE_KEY, itemId)
  window.dispatchEvent(new CustomEvent(INBOX_ITEM_EVENT, { detail: { itemId } }))
}

export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed)
}

export async function createQuickNotePage(args: {
  title: string
  content?: string
  tags?: string[]
}) {
  const notebooksRes = await notes.listNotebooks()
  const notebook = notebooksRes.notebooks[0]
  if (!notebook) throw new Error('No notebook available')

  const sectionsRes = await notes.listSections(notebook.id)
  const section = sectionsRes.sections[0] ?? (await notes.createSection({
    notebookId: notebook.id,
    name: 'General',
    color: notebook.color,
  })).section

  return notes.createPage({
    notebookId: notebook.id,
    sectionId: section.id,
    title: args.title,
    content: args.content ?? '',
    tags: args.tags ?? [],
  })
}