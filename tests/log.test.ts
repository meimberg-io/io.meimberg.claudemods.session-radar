import { expect, test } from 'claude-code/testing'

import { MAX_LINES, createLog } from '../hooks/log'
import type { FsLike } from '../hooks/log'

function memory(files: Record<string, string> = {}): FsLike & { files: Record<string, string> } {
  return {
    files,
    read: async path => {
      const text = files[path]
      if (text === undefined) throw new Error('missing')
      return text
    },
    write: async (path, text) => {
      files[path] = text
    },
  }
}

function lines(text: string | undefined): Record<string, unknown>[] {
  return (text ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}

test('added events land as one JSON line each, in order', async () => {
  const fs = memory()
  const log = createLog(fs)
  log.add('/l/a.jsonl', { t: 1, k: 'prompt' })
  log.add('/l/a.jsonl', { t: 2, k: 'tool.check', decision: 'ask' })
  await log.idle()
  expect(lines(fs.files['/l/a.jsonl'])).toEqual([
    { t: 1, k: 'prompt' },
    { t: 2, k: 'tool.check', decision: 'ask' },
  ])
})

test('a log that exists already is continued, not replaced', async () => {
  const fs = memory({ '/l/a.jsonl': '{"t":0,"k":"old"}\n' })
  const log = createLog(fs)
  log.add('/l/a.jsonl', { t: 1, k: 'new' })
  await log.idle()
  expect(lines(fs.files['/l/a.jsonl']).map(l => l.k)).toEqual(['old', 'new'])
})

test('a log keeps only its newest lines', async () => {
  const fs = memory()
  const log = createLog(fs)
  for (let i = 0; i < MAX_LINES + 5; i++) log.add('/l/a.jsonl', { t: i, k: 'x' })
  await log.idle()
  const got = lines(fs.files['/l/a.jsonl'])
  expect(got.length).toBe(MAX_LINES)
  expect(got[0]?.t).toBe(5)
})

test('two files are kept apart', async () => {
  const fs = memory()
  const log = createLog(fs)
  log.add('/l/a.jsonl', { t: 1, k: 'a' })
  log.add('/l/b.jsonl', { t: 1, k: 'b' })
  await log.idle()
  expect(lines(fs.files['/l/a.jsonl']).map(l => l.k)).toEqual(['a'])
  expect(lines(fs.files['/l/b.jsonl']).map(l => l.k)).toEqual(['b'])
})

test('a failing write loses nothing for the next flush and does not throw', async () => {
  const fs = memory()
  let fail = true
  const log = createLog({ read: fs.read, write: async (p, t) => (fail ? Promise.reject(new Error('disk')) : fs.write(p, t)) })
  log.add('/l/a.jsonl', { t: 1, k: 'a' })
  await log.idle()
  fail = false
  log.add('/l/a.jsonl', { t: 2, k: 'b' })
  await log.idle()
  expect(lines(fs.files['/l/a.jsonl']).map(l => l.k)).toEqual(['a', 'b'])
})
