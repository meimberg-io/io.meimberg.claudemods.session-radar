import type { EngineInterface } from 'claude-code'

import type { Entry } from '../types'

// Where sessions meet: one key per session in the plugin's own store, shared
// by every session on this machine. Kept behind these four calls so the store
// can be swapped for a file per session.

export const KEY_PREFIX = 'session:'
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
    typeof e.heartbeat === 'number' &&
    typeof e.updatedAt === 'number'
  )
}

export async function writeEntry($: EngineInterface, entry: Entry): Promise<void> {
  await $.store.set(KEY_PREFIX + entry.id, entry)
}

export async function removeEntry($: EngineInterface, id: string): Promise<void> {
  await $.store.delete(KEY_PREFIX + id)
}

export async function readEntries($: EngineInterface): Promise<Entry[]> {
  const out: Entry[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const value = await $.store.get(key)
    if (isEntry(value)) out.push(value)
  }
  return out
}

// Drops entries whose heartbeat is older than a day; answers how many.
export async function pruneOld($: EngineInterface, now: number): Promise<number> {
  let dropped = 0
  for (const e of await readEntries($)) {
    if (e.heartbeat < now - PRUNE_MS) {
      await removeEntry($, e.id)
      dropped++
    }
  }
  return dropped
}
