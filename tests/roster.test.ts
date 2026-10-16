import { expect, test } from 'claude-code/testing'

import { groupRoster } from '../hooks/roster'
import type { Entry } from '../types'

const NOW = 10_000_000

function entry(over: Partial<Entry>): Entry {
  return {
    v: 1,
    id: 'a',
    title: 'repo: task',
    cwd: '/repo',
    status: 'idle',
    startedAt: 0,
    updatedAt: NOW,
    heartbeat: NOW,
    ...over,
  }
}

test('a working session without heartbeat for two minutes drops out', async () => {
  const fresh = entry({ id: 'fresh', status: 'working', heartbeat: NOW - 119_000 })
  const stale = entry({ id: 'stale', status: 'working', heartbeat: NOW - 121_000 })
  const { working } = groupRoster([fresh, stale], NOW)
  expect(working.map(r => r.id)).toEqual(['fresh'])
})

test('a waiting session without heartbeat greys out and drops after thirty minutes', async () => {
  const grey = entry({ id: 'grey', status: 'waiting', waitingSince: 1, heartbeat: NOW - 5 * 60_000 })
  const gone = entry({ id: 'gone', status: 'waiting', waitingSince: 1, heartbeat: NOW - 31 * 60_000 })
  const { waiting } = groupRoster([grey, gone], NOW)
  expect(waiting.map(r => [r.id, r.isStale])).toEqual([['grey', true]])
})

test('groups sort by longest wait, latest update and latest turn end', async () => {
  const list = [
    entry({ id: 'w-new', status: 'waiting', waitingSince: NOW - 10 }),
    entry({ id: 'w-old', status: 'waiting', waitingSince: NOW - 99 }),
    entry({ id: 'r-old', status: 'working', updatedAt: NOW - 50 }),
    entry({ id: 'r-new', status: 'working', updatedAt: NOW - 5 }),
    entry({ id: 'i-old', status: 'idle', lastTurnEndedAt: NOW - 70 }),
    entry({ id: 'i-new', status: 'idle', lastTurnEndedAt: NOW - 7 }),
  ]
  const g = groupRoster(list, NOW)
  expect(g.waiting.map(r => r.id)).toEqual(['w-old', 'w-new'])
  expect(g.working.map(r => r.id)).toEqual(['r-new', 'r-old'])
  expect(g.idle.map(r => r.id)).toEqual(['i-new', 'i-old'])
})

test('two sessions with the same title and folder stay two rows', async () => {
  const { idle } = groupRoster([entry({ id: 'one' }), entry({ id: 'two' })], NOW)
  expect(idle.map(r => r.id).sort()).toEqual(['one', 'two'])
})
