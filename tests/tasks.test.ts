import { expect, test } from 'claude-code/testing'

import { applyTaskCall, summarize } from '../hooks/tasks'
import type { TaskList } from '../hooks/tasks'

const PLAN = 'mcp__ccd_turn__update_plan'
const three = {
  items: [
    { content: 'Look around', status: 'in_progress' },
    { content: 'Build it', status: 'pending' },
    { content: 'Test it', status: 'pending' },
  ],
}

function plan(input: unknown, prev?: TaskList): TaskList {
  const list = applyTaskCall(prev, PLAN, input)
  if (!list) throw new Error('no list')
  return list
}

test('a new plan counts nothing done and names the running step', async () => {
  expect(summarize(plan(three))).toEqual({ done: 0, total: 3, current: 'Look around' })
})

test('advance completes the running step and starts the next', async () => {
  const next = plan({ advance: true }, plan(three))
  expect(next.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(summarize(next)).toEqual({ done: 1, total: 3, current: 'Build it' })
})

test('done and start set steps by their 1-based number', async () => {
  const next = plan({ done: [1, 2], start: 3 }, plan(three))
  expect(next.map(t => t.status)).toEqual(['completed', 'completed', 'in_progress'])
})

test('TodoWrite replaces the list', async () => {
  const list = applyTaskCall(plan(three), 'TodoWrite', { todos: [{ content: 'Only one', status: 'pending' }] })
  expect(list?.map(t => t.content)).toEqual(['Only one'])
})

test('another tool or broken input keeps the list as it was', async () => {
  const before = plan(three)
  expect(applyTaskCall(before, 'Bash', { command: 'ls' })).toBe(before)
  expect(applyTaskCall(before, PLAN, 'nonsense')).toBe(before)
  expect(applyTaskCall(before, PLAN, { items: [{ nope: 1 }] })).toBe(before)
})

test('a finished list has no current step', async () => {
  expect(summarize(plan({ done: [1, 2, 3] }, plan(three)))).toEqual({ done: 3, total: 3, current: '' })
})
