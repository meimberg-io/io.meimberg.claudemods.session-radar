import type { Entry } from '../types'

// No heartbeat for this long: a working or idle session is gone, a waiting one greys out.
export const STALE_MS = 120_000
// A waiting session is dropped only after this long without a heartbeat.
export const WAIT_DROP_MS = 1_800_000

export type Row = Entry & { isStale: boolean }

export function groupRoster(
  entries: readonly Entry[],
  now: number,
): { waiting: Row[]; working: Row[]; idle: Row[] } {
  const waiting: Row[] = []
  const working: Row[] = []
  const idle: Row[] = []

  for (const e of entries) {
    const silent = now - e.heartbeat
    const isStale = silent > STALE_MS
    if (e.status === 'waiting') {
      if (silent <= WAIT_DROP_MS) waiting.push({ ...e, isStale })
    } else if (!isStale) {
      ;(e.status === 'working' ? working : idle).push({ ...e, isStale })
    }
  }

  waiting.sort((a, b) => (a.waitingSince ?? a.updatedAt) - (b.waitingSince ?? b.updatedAt))
  working.sort((a, b) => b.updatedAt - a.updatedAt)
  idle.sort((a, b) => (b.lastTurnEndedAt ?? b.updatedAt) - (a.lastTurnEndedAt ?? a.updatedAt))

  return { waiting, working, idle }
}
