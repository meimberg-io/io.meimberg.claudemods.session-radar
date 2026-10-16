import { expect, mock, test } from 'claude-code/testing'

import { pruneOld, readEntries, removeEntry, writeEntry } from '../hooks/channel'
import type { Entry } from '../types'

const DAY = 86_400_000
const NOW = 100 * DAY

function entry(over: Partial<Entry> = {}): Entry {
  return { v: 1, id: 'a', title: 't', cwd: '/r', status: 'idle', startedAt: 0, updatedAt: NOW, heartbeat: NOW, ...over }
}

test('a written entry is read back', async ($, on) => {
  mock.store(on)
  await writeEntry($, entry({ id: 'x' }))
  expect((await readEntries($)).map(e => e.id)).toEqual(['x'])
})

test('broken, foreign and spike entries are skipped', async ($, on) => {
  mock.store(on, {
    'session:good': entry({ id: 'good' }),
    'session:null': null,
    'session:text': 'hello',
    'session:old': { v: 0, id: 'old', status: 'idle' },
    'session:noid': { v: 1, status: 'idle' },
    'session:nostatus': { v: 1, id: 'n' },
    's:spike': entry({ id: 'spike' }),
  })
  expect((await readEntries($)).map(e => e.id)).toEqual(['good'])
})

test('entries older than a day are pruned, younger ones stay', async ($, on) => {
  mock.store(on, {
    'session:old': entry({ id: 'old', heartbeat: NOW - DAY - 1 }),
    'session:young': entry({ id: 'young', heartbeat: NOW - DAY + 1 }),
  })
  expect(await pruneOld($, NOW)).toBe(1)
  expect((await readEntries($)).map(e => e.id)).toEqual(['young'])
})

test('removing an entry removes only that key', async ($, on) => {
  mock.store(on, { 'session:a': entry({ id: 'a' }), 'session:b': entry({ id: 'b' }) })
  await removeEntry($, 'a')
  expect((await readEntries($)).map(e => e.id)).toEqual(['b'])
})
