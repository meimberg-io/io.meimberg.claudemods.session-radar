import { expect, test } from 'claude-code/testing'

import { pruneOld, readEntries, removeEntry, writeEntry } from '../hooks/channel'
import type { StoreLike } from '../hooks/channel'
import type { Entry } from '../types'

function memory(entries: Record<string, unknown> = {}): StoreLike {
  const m = new Map(Object.entries(entries))
  return {
    get: async k => m.get(k),
    set: async (k, v) => void m.set(k, JSON.parse(JSON.stringify(v))),
    delete: async k => void m.delete(k),
    keys: async () => [...m.keys()],
  }
}

const DAY = 86_400_000
const NOW = 100 * DAY

function entry(over: Partial<Entry> = {}): Entry {
  return { v: 1, id: 'a', title: 't', cwd: '/r', status: 'idle', startedAt: 0, updatedAt: NOW, heartbeat: NOW, ...over }
}

test('a written entry is read back', async () => {
  const store = memory()
  await writeEntry(store, entry({ id: 'x' }))
  expect((await readEntries(store)).map(e => e.id)).toEqual(['x'])
})

test('broken, foreign and spike entries are skipped', async () => {
  const store = memory({
    'session:good': entry({ id: 'good' }),
    'session:null': null,
    'session:text': 'hello',
    'session:old': { v: 0, id: 'old', status: 'idle' },
    'session:noid': { v: 1, status: 'idle' },
    'session:nostatus': { v: 1, id: 'n' },
    's:spike': entry({ id: 'spike' }),
  })
  expect((await readEntries(store)).map(e => e.id)).toEqual(['good'])
})

test('entries older than a day are pruned, younger ones stay', async () => {
  const store = memory({
    'session:old': entry({ id: 'old', heartbeat: NOW - DAY - 1 }),
    'session:young': entry({ id: 'young', heartbeat: NOW - DAY + 1 }),
  })
  expect(await pruneOld(store, NOW)).toBe(1)
  expect((await readEntries(store)).map(e => e.id)).toEqual(['young'])
})

test('removing an entry removes only that key', async () => {
  const store = memory({ 'session:a': entry({ id: 'a' }), 'session:b': entry({ id: 'b' }) })
  await removeEntry(store, 'a')
  expect((await readEntries(store)).map(e => e.id)).toEqual(['b'])
})

test('an entry without title, folder or start time is skipped', async () => {
  const store = memory({
    'session:a': { v: 1, id: 'a', status: 'idle', heartbeat: NOW, updatedAt: NOW, startedAt: 0 },
    'session:b': { v: 1, id: 'b', title: 't', cwd: '/r', status: 'idle', heartbeat: NOW, updatedAt: NOW },
  })
  expect(await readEntries(store)).toEqual([])
})

test('optional fields of the wrong type are dropped on read', async () => {
  const store = memory({ 'session:a': { ...entry({ id: 'a' }), costUsd: 'x', contextPercent: null, waitingSince: 'soon', tasks: 'nope', title: 'zwei\nZeilen' } })
  const [read] = await readEntries(store)
  expect(read?.costUsd).toBeUndefined()
  expect(read?.contextPercent).toBeUndefined()
  expect(read?.waitingSince).toBeUndefined()
  expect(read?.tasks).toBeUndefined()
  expect(read?.title).toBe('zwei Zeilen')
})

test('broken session keys are pruned too', async () => {
  const store = memory({ 'session:junk': 'hello', 'session:ok': entry({ id: 'ok' }) })
  await pruneOld(store, NOW)
  expect(await store.keys()).toEqual(['session:ok'])
})
