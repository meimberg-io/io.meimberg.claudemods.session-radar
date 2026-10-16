import { expect, test } from 'claude-code/testing'

import { applySignal } from '../hooks/status'
import type { Entry } from '../types'

const T0 = 1_000_000

function entry(over: Partial<Entry> = {}): Entry {
  return {
    v: 1,
    id: 'a',
    title: 'repo: task',
    cwd: '/repo',
    status: 'idle',
    startedAt: T0,
    updatedAt: T0,
    heartbeat: T0,
    ...over,
  }
}

test('prompt from idle is working and drops the wait reason', async () => {
  const next = applySignal(entry({ waitReason: 'question' }), { kind: 'prompt' }, T0 + 1)
  expect(next.status).toBe('working')
  expect(next.waitReason).toBeUndefined()
})

test('a permission prompt is waiting for that tool since now', async () => {
  const next = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'permission', tool: 'Bash' }, T0 + 5)
  expect(next.status).toBe('waiting')
  expect(next.waitReason).toBe('permission')
  expect(next.waitTool).toBe('Bash')
  expect(next.waitingSince).toBe(T0 + 5)
})

test('an answered permission goes back to working', async () => {
  const waiting = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'permission', tool: 'Bash' }, T0 + 5)
  const next = applySignal(waiting, { kind: 'waitEnd' }, T0 + 9)
  expect(next.status).toBe('working')
  expect(next.waitReason).toBeUndefined()
  expect(next.waitTool).toBeUndefined()
  expect(next.waitingSince).toBeUndefined()
})

test('a question and a plan are waiting with their reason', async () => {
  const q = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'question' }, T0 + 1)
  const p = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'plan' }, T0 + 1)
  expect([q.status, q.waitReason]).toEqual(['waiting', 'question'])
  expect([p.status, p.waitReason]).toEqual(['waiting', 'plan'])
})

test('a next-step question outlives the end of the turn', async () => {
  const asked = applySignal(entry({ status: 'working' }), { kind: 'nextStepAsk' }, T0 + 1)
  const next = applySignal(asked, { kind: 'turnEnd' }, T0 + 2)
  expect(next.status).toBe('waiting')
  expect(next.waitReason).toBe('nextstep')
  expect(next.isSticky).toBe(true)
})

test('the next prompt answers a sticky next-step question', async () => {
  const asked = applySignal(entry({ status: 'working' }), { kind: 'nextStepAsk' }, T0 + 1)
  const ended = applySignal(asked, { kind: 'turnEnd' }, T0 + 2)
  const next = applySignal(ended, { kind: 'prompt' }, T0 + 3)
  expect(next.status).toBe('working')
  expect(next.isSticky).toBe(false)
})

test('a turn interrupted while a permission waits is idle', async () => {
  const waiting = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'permission', tool: 'Bash' }, T0 + 1)
  const next = applySignal(waiting, { kind: 'turnEnd' }, T0 + 2)
  expect(next.status).toBe('idle')
  expect(next.waitReason).toBeUndefined()
})

test('the end of a turn is idle and stamps lastTurnEndedAt', async () => {
  const next = applySignal(entry({ status: 'working' }), { kind: 'turnEnd' }, T0 + 7)
  expect(next.status).toBe('idle')
  expect(next.lastTurnEndedAt).toBe(T0 + 7)
})

test('a second wait keeps the first waitingSince', async () => {
  const first = applySignal(entry({ status: 'working' }), { kind: 'waitStart', reason: 'permission', tool: 'Bash' }, T0 + 1)
  const second = applySignal(first, { kind: 'waitStart', reason: 'permission', tool: 'Edit' }, T0 + 9)
  expect(second.waitingSince).toBe(T0 + 1)
  expect(second.waitTool).toBe('Edit')
})

test('every signal stamps updatedAt and returns a new object', async () => {
  const before = entry()
  const next = applySignal(before, { kind: 'turnStart' }, T0 + 4)
  expect(next).not.toBe(before)
  expect(next.updatedAt).toBe(T0 + 4)
  expect(before.updatedAt).toBe(T0)
})
