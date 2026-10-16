import type { Entry, Signal } from '../types'

// What a session is after a signal: pure, the store is written elsewhere.
export function applySignal(entry: Entry, signal: Signal, now: number): Entry {
  const base = { ...entry, updatedAt: now }
  const cleared = {
    ...base,
    waitReason: undefined,
    waitTool: undefined,
    waitingSince: undefined,
    isSticky: false,
  }

  switch (signal.kind) {
    case 'prompt':
    case 'turnStart':
      return signal.kind === 'prompt' || entry.status !== 'waiting' ? { ...cleared, status: 'working' } : base
    case 'waitStart':
      return {
        ...base,
        status: 'waiting',
        waitReason: signal.reason,
        waitTool: signal.tool,
        waitingSince: entry.status === 'waiting' ? entry.waitingSince ?? now : now,
        isSticky: false,
      }
    case 'waitEnd':
      if (entry.isSticky) return base
      return { ...cleared, status: 'working' }
    case 'nextStepAsk':
      return {
        ...base,
        status: 'waiting',
        waitReason: 'nextstep',
        waitTool: undefined,
        waitingSince: entry.status === 'waiting' ? entry.waitingSince ?? now : now,
        isSticky: true,
      }
    case 'turnEnd':
      if (entry.isSticky) return { ...base, lastTurnEndedAt: now }
      return { ...cleared, status: 'idle', lastTurnEndedAt: now }
  }
}
