export type Status = 'waiting' | 'working' | 'idle'
export type WaitReason = 'permission' | 'question' | 'plan' | 'nextstep'
export type Tasks = { done: number; total: number; current: string }

export type Entry = {
  v: 1
  id: string
  title: string
  cwd: string
  status: Status
  waitReason?: WaitReason
  // The tool a permission prompt is for.
  waitTool?: string
  waitingSince?: number
  // A next-step question outlives the turn's end, until the next prompt.
  isSticky?: boolean
  tasks?: Tasks
  model?: string
  contextPercent?: number
  costUsd?: number
  startedAt: number
  updatedAt: number
  lastTurnEndedAt?: number
  heartbeat: number
}

export type Signal =
  | { kind: 'prompt' }
  | { kind: 'turnStart' }
  // turn.complete or turn.abort of the main loop
  | { kind: 'turnEnd' }
  | { kind: 'waitStart'; reason: Exclude<WaitReason, 'nextstep'>; tool?: string }
  // a permission, question or plan was answered
  | { kind: 'waitEnd' }
  // wrap_up with an ask, or blocked
  | { kind: 'nextStepAsk' }

declare module 'claude-code' {
  interface PluginState {
    'session-radar': { roster: Entry[]; selfId: string; isDoneOpen: boolean }
  }
}
