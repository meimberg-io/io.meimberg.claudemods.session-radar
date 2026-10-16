import type { Tasks } from '../types'

// A session's task list, rebuilt from the tool calls that keep it.

type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type TaskList = { content: string; status: TaskStatus }[]

const PLAN = 'mcp__ccd_turn__update_plan'
const STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

function listOf(raw: unknown): TaskList | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: TaskList = []
  for (const item of raw) {
    const t = item as { content?: unknown; status?: unknown }
    if (typeof t?.content !== 'string' || typeof t.status !== 'string' || !STATUSES.has(t.status)) return undefined
    out.push({ content: t.content, status: t.status as TaskStatus })
  }
  return out
}

function steps(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n)) : []
}

export function applyTaskCall(prev: TaskList | undefined, tool: string, input: unknown): TaskList | undefined {
  if (typeof input !== 'object' || input === null) return prev
  const i = input as Record<string, unknown>

  if (tool === 'TodoWrite') return listOf(i.todos) ?? prev
  if (tool !== PLAN) return prev

  if (i.items !== undefined) return listOf(i.items) ?? prev
  if (!prev) return prev

  const next = prev.map(t => ({ ...t }))
  if (i.advance === true) {
    const running = next.findIndex(t => t.status === 'in_progress')
    if (running >= 0) next[running]!.status = 'completed'
    const pending = next.findIndex(t => t.status === 'pending')
    if (pending >= 0) next[pending]!.status = 'in_progress'
  }
  for (const n of steps(i.done)) if (next[n - 1]) next[n - 1]!.status = 'completed'
  if (Number.isInteger(i.start)) {
    const t = next[(i.start as number) - 1]
    if (t) t.status = 'in_progress'
  }
  return next
}

export function summarize(list: TaskList): Tasks {
  return {
    done: list.filter(t => t.status === 'completed').length,
    total: list.length,
    current: list.find(t => t.status === 'in_progress')?.content ?? '',
  }
}
