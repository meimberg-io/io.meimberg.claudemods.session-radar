import type { EngineInterface } from 'claude-code'

import type { Entry } from '../types'

// What the channel needs of $.store; tests hand it a store in memory.
export type StoreLike = Pick<EngineInterface['store'], 'get' | 'set' | 'delete' | 'keys'>

// Where sessions meet: one key per session in the plugin's own store, shared
// by every session on this machine. Kept behind these four calls so the store
// can be swapped for a file per session.

export const KEY_PREFIX = 'session:'
// What a desktop app session id looks like; nothing else goes into a link.
export const HOST_ID = /^local_[0-9a-f-]+$/i
const PRUNE_MS = 86_400_000

const STATUSES = new Set(['waiting', 'working', 'idle'])

export function isEntry(x: unknown): x is Entry {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  return (
    e.v === 1 &&
    typeof e.id === 'string' &&
    typeof e.status === 'string' &&
    STATUSES.has(e.status) &&
    typeof e.title === 'string' &&
    typeof e.cwd === 'string' &&
    isNumber(e.heartbeat) &&
    isNumber(e.updatedAt) &&
    isNumber(e.startedAt)
  )
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// An entry as the pane can draw it: optional fields of the wrong type dropped,
// text on one line.
function sanitize(e: Entry): Entry {
  const out: Entry = { ...e, title: oneLine(e.title) }
  for (const key of ['waitingSince', 'contextPercent', 'costUsd', 'lastTurnEndedAt'] as const) {
    if (out[key] !== undefined && !isNumber(out[key])) delete out[key]
  }
  if (out.hostId !== undefined && !(typeof out.hostId === 'string' && HOST_ID.test(out.hostId))) delete out.hostId
  for (const key of ['waitTool', 'model'] as const) {
    if (out[key] !== undefined && typeof out[key] !== 'string') delete out[key]
  }
  if (out.waitLoops !== undefined && !(Array.isArray(out.waitLoops) && out.waitLoops.every(l => typeof l === 'string'))) {
    delete out.waitLoops
  }
  const t = out.tasks as unknown as { done?: unknown; total?: unknown; current?: unknown } | undefined
  if (t !== undefined) {
    if (typeof t !== 'object' || t === null || !isNumber(t.done) || !isNumber(t.total) || typeof t.current !== 'string') {
      delete out.tasks
    } else {
      out.tasks = { done: t.done, total: t.total, current: oneLine(t.current) }
    }
  }
  return out
}

export async function writeEntry(store: StoreLike, entry: Entry): Promise<void> {
  await store.set(KEY_PREFIX + entry.id, entry)
}

export async function removeEntry(store: StoreLike, id: string): Promise<void> {
  await store.delete(KEY_PREFIX + id)
}

export async function readEntries(store: StoreLike): Promise<Entry[]> {
  const out: Entry[] = []
  for (const key of await store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const value = await store.get(key)
    if (isEntry(value)) out.push(sanitize(value))
  }
  return out
}

// Drops entries whose heartbeat is older than a day; answers how many.
// Unreadable session keys go too.
export async function pruneOld(store: StoreLike, now: number): Promise<number> {
  let dropped = 0
  for (const key of await store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const value = await store.get(key)
    if (!isEntry(value) || value.heartbeat < now - PRUNE_MS) {
      await store.delete(key)
      dropped++
    }
  }
  return dropped
}
