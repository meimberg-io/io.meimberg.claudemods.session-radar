// The measuring log: one JSON line per event, a file per session. Each file
// is held in memory and written whole, as $.fs writes whole files; one write
// at a time, so lines added while a write runs go out with the next.

export const MAX_LINES = 3000

export type FsLike = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

export type Log = {
  add: (path: string, line: Record<string, unknown>) => void
  // Resolves once everything added so far was written, or failed to be.
  idle: () => Promise<void>
}

export function createLog(fs: FsLike): Log {
  const held = new Map<string, string[]>()
  const pending = new Map<string, string[]>()
  let running: Promise<void> = Promise.resolve()

  async function flush(path: string): Promise<void> {
    const fresh = pending.get(path) ?? []
    if (fresh.length === 0) return
    pending.set(path, [])
    let lines = held.get(path)
    if (!lines) {
      try {
        lines = (await fs.read(path)).split('\n').filter(Boolean)
      } catch {
        lines = []
      }
    }
    const next = [...lines, ...fresh].slice(-MAX_LINES)
    try {
      await fs.write(path, next.join('\n') + '\n')
      held.set(path, next)
    } catch {
      // Kept for the next flush rather than lost.
      held.set(path, lines)
      pending.set(path, [...fresh, ...(pending.get(path) ?? [])])
    }
  }

  return {
    add(path, line) {
      let text: string
      try {
        text = JSON.stringify(line)
      } catch {
        return
      }
      pending.set(path, [...(pending.get(path) ?? []), text])
      running = running.then(() => flush(path))
    },
    idle: () => running,
  }
}
