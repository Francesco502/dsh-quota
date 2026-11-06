/**
 * Append-only quota history journal (0.4.1).
 *
 * Storage layout: one JSON object per line in `$DSH_HOME/quota-history.jsonl`:
 *
 *   { "k": "<instanceId[::poolId::windowId]>", "ts": 1710000000000,
 *     "r": 71.5, "u": 28.5, "resetAt"?: "...", "kind": "usage" }
 *   { "k": "deepseek", "ts": 1710000000000, "balance": 12.34, "kind": "balance" }
 *
 * Why JSONL: `recordSnapshots` used to serialize the whole `Map` and rewrite the
 * file on every save (A5: ~1.87 GB/day of write amplification, growing to tens of
 * GB/day at 30 days of retention). Appending only the points that actually changed
 * is O(new points) instead of O(all history) and is safe for concurrent writers.
 *
 * Truthfulness: only windows that pass `isQuantified()` are journaled. Balance-only
 * series store `balance` and never a synthesized percentage; liveness/unknown
 * windows are not recorded at all.
 *
 * Corruption: an unparsable line quarantines the whole journal as
 * `quota-history.jsonl.corrupt-<ts>` and rebuilds it from memory. Compaction keeps
 * the previous file as `quota-history.jsonl.bak`.
 */
import type { AuthCardItem, QuotaHistoryPoint } from './types.ts'
import { isQuantified } from './types.ts'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { appendFile, copyFile, open, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Hard cap per series key (A4: the old 2000-point limit was dead code). */
const MAX_POINTS_PER_KEY = 2000
/** Retention window. */
const MAX_DAYS = 30
const DAY_MS = 24 * 3600 * 1000
/** Points closer together than this only land in the journal when the value changed. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000
/** Coalesce appends so a burst of refreshes becomes one `appendFile`. */
const FLUSH_DELAY_MS = 200
/** Force an immediate flush once this many lines are queued (bounds memory). */
const FLUSH_EAGER_LINES = 1000

type StoredKind = 'usage' | 'balance'

interface StoredPoint {
  timestamp: number
  kind?: StoredKind
  remainingPercent?: number
  usedPercent?: number
  remainingBalance?: number
  resetAt?: string
}

function cutoffFor(days = MAX_DAYS): number {
  return Date.now() - days * DAY_MS
}

function encodePoint(key: string, point: StoredPoint): string {
  const line: Record<string, unknown> = { k: key, ts: point.timestamp }
  if (point.remainingPercent !== undefined) line.r = point.remainingPercent
  if (point.usedPercent !== undefined) line.u = point.usedPercent
  if (point.remainingBalance !== undefined) line.balance = point.remainingBalance
  if (point.resetAt !== undefined) line.resetAt = point.resetAt
  if (point.kind !== undefined) line.kind = point.kind
  return JSON.stringify(line)
}

function decodePoint(line: string): { key: string; point: StoredPoint } | undefined {
  let raw: any
  try {
    raw = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || typeof raw.k !== 'string' || raw.k.length === 0) return undefined
  if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) return undefined
  const point: StoredPoint = { timestamp: raw.ts }
  if (typeof raw.r === 'number' && Number.isFinite(raw.r)) point.remainingPercent = raw.r
  if (typeof raw.u === 'number' && Number.isFinite(raw.u)) point.usedPercent = raw.u
  if (typeof raw.balance === 'number' && Number.isFinite(raw.balance)) point.remainingBalance = raw.balance
  if (typeof raw.resetAt === 'string') point.resetAt = raw.resetAt
  if (raw.kind === 'usage' || raw.kind === 'balance') point.kind = raw.kind
  if (point.remainingPercent === undefined && point.remainingBalance === undefined) return undefined
  return { key: raw.k, point }
}

function normalizeLegacyPoint(raw: any, cutoff: number): StoredPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const timestamp = typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : undefined
  if (timestamp === undefined || timestamp < cutoff) return undefined
  const point: StoredPoint = { timestamp }
  if (typeof raw.remainingPercent === 'number' && Number.isFinite(raw.remainingPercent)) {
    point.remainingPercent = raw.remainingPercent
  }
  if (typeof raw.usedPercent === 'number' && Number.isFinite(raw.usedPercent)) {
    point.usedPercent = raw.usedPercent
  }
  if (typeof raw.remainingBalance === 'number' && Number.isFinite(raw.remainingBalance)) {
    point.remainingBalance = raw.remainingBalance
  }
  if (typeof raw.resetAt === 'string') point.resetAt = raw.resetAt
  if (point.remainingPercent === undefined && point.remainingBalance === undefined) return undefined
  // Legacy card-level points derived a ratio from a balance; keep the archived numbers but
  // label the series so burn-rate math never treats a money ratio as a quota percentage.
  point.kind = point.remainingBalance !== undefined && point.remainingPercent !== undefined ? 'usage' : point.remainingPercent !== undefined ? 'usage' : 'balance'
  return point
}

// One process exit hook for every live manager instead of one listener per instance.
const liveHistories = new Set<QuotaHistoryManager>()
let exitHookInstalled = false
function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const history of liveHistories) {
      try {
        history.flushSync()
      } catch {}
    }
  })
}

export class QuotaHistoryManager {
  private readonly journalPath: string
  private readonly legacyPath: string
  private readonly points: Map<string, StoredPoint[]> = new Map()

  /** Resolves when the on-disk journal (and any legacy migration) has been read. */
  public readonly ready: Promise<void>

  private pendingLines: string[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private flushPromise: Promise<boolean> | null = null
  private compactPromise: Promise<boolean> | null = null
  private compactTimer: ReturnType<typeof setInterval> | undefined
  private lastSaveError: string | undefined

  constructor() {
    const dshDir = process.env.DSH_HOME || join(homedir(), '.dsh')
    try {
      if (!existsSync(dshDir)) mkdirSync(dshDir, { recursive: true })
    } catch {}
    this.journalPath = join(dshDir, 'quota-history.jsonl')
    this.legacyPath = join(dshDir, 'quota-history.json')
    liveHistories.add(this)
    installExitHook()
    this.ready = this.load()
    // Daily compaction: enforces the 30-day / 2000-point bounds on disk and keeps `.bak`.
    this.compactTimer = setInterval(() => {
      void this.compact().catch(() => {})
    }, DAY_MS)
    if (typeof (this.compactTimer as any).unref === 'function') (this.compactTimer as any).unref()

    this.dispose = () => {
      liveHistories.delete(this)
      try {
        this.flushSync()
      } catch {}
    }
  }

  /** Detach timers and flush once; safe to call from tests. */
  private dispose: () => void

  close(): void {
    try {
      if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
      if (this.compactTimer !== undefined) clearInterval(this.compactTimer)
      this.flushTimer = undefined
      this.compactTimer = undefined
    } catch {}
    this.dispose()
  }

  // ---------------------------------------------------------------- loading

  load(): Promise<void> {
    return this.loadFromDisk()
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const migrated = await this.migrateLegacy()
      // Keep migrated points in memory even if the journal itself is corrupt below.
      for (const [key, list] of migrated) this.mergePoints(key, list)
      const { entries, corrupt, trailingPartial } = await this.readJournal()
      if (corrupt) {
        const quarantine = `${this.journalPath}.corrupt-${Date.now()}`
        try {
          await rename(this.journalPath, quarantine)
        } catch {}
        this.lastSaveError = 'history journal corrupt; quarantined'
        // Rebuild from whatever is already in memory (this process may have recorded
        // points between construction and the async load finishing).
        this.scheduleCompactRebuild()
      } else {
        for (const [key, list] of entries) this.mergePoints(key, list)
        if (trailingPartial) this.scheduleCompactRebuild()
      }
      this.trimMemory(cutoffFor())
    } catch (err: any) {
      this.lastSaveError = err?.message ?? String(err)
    }
  }

  private scheduleCompactRebuild(): void {
    const timer = setTimeout(() => {
      void this.compactNow().catch(() => {})
    }, 0)
    if (typeof (timer as any).unref === 'function') (timer as any).unref()
  }

  /**
   * Stream the journal line by line. A single unparsable *last* line is treated as a
   * crash-truncated tail (dropped, journal rewritten); anything else quarantines the file.
   */
  private async readJournal(): Promise<{
    entries: Map<string, StoredPoint[]>
    corrupt: boolean
    trailingPartial: boolean
  }> {
    const entries = new Map<string, StoredPoint[]>()
    if (!existsSync(this.journalPath)) return { entries, corrupt: false, trailingPartial: false }

    const endedWithNewline = await this.fileEndsWithNewline()
    const failures: number[] = []
    let lineIndex = 0
    const reader = createInterface({
      input: createReadStream(this.journalPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    for await (const rawLine of reader) {
      const line = rawLine.trim()
      if (line.length > 0) {
        const decoded = decodePoint(line)
        if (!decoded) {
          failures.push(lineIndex)
        } else {
          const list = entries.get(decoded.key)
          if (list) list.push(decoded.point)
          else entries.set(decoded.key, [decoded.point])
        }
      }
      lineIndex += 1
    }

    const truncatedTail =
      !endedWithNewline && failures.length === 1 && failures[0] === lineIndex - 1
    if (failures.length > 0 && !truncatedTail) {
      return { entries: new Map(), corrupt: true, trailingPartial: false }
    }
    return { entries, corrupt: false, trailingPartial: truncatedTail || (!endedWithNewline && lineIndex > 0) }
  }

  private async fileEndsWithNewline(): Promise<boolean> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(this.journalPath, 'r')
      const info = await handle.stat()
      if (info.size === 0) return true
      const buf = Buffer.alloc(1)
      await handle.read(buf, 0, 1, info.size - 1)
      return buf[0] === 0x0a
    } catch {
      return true
    } finally {
      try {
        await handle?.close()
      } catch {}
    }
  }

  /** One-time import of the pre-0.4.1 `quota-history.json`; the old file is renamed, never deleted. */
  private async migrateLegacy(): Promise<Map<string, StoredPoint[]>> {
    const migrated = new Map<string, StoredPoint[]>()
    if (!existsSync(this.legacyPath)) return migrated
    let parsed: any
    try {
      parsed = JSON.parse(readFileSync(this.legacyPath, 'utf8'))
    } catch {
      try {
        await rename(this.legacyPath, `${this.legacyPath}.corrupt-${Date.now()}`)
      } catch {}
      return migrated
    }

    const cutoff = cutoffFor()
    const lines: string[] = []
    const records = parsed && typeof parsed === 'object' ? parsed.records : undefined
    if (records && typeof records === 'object') {
      for (const [key, list] of Object.entries(records)) {
        if (!Array.isArray(list)) continue
        const points = migrated.get(key) ?? []
        for (const raw of list) {
          const point = normalizeLegacyPoint(raw, cutoff)
          if (!point) continue
          points.push(point)
          lines.push(encodePoint(key, point))
        }
        if (points.length > 0) migrated.set(key, points)
      }
    }

    if (lines.length > 0) {
      try {
        await appendFile(this.journalPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch (err: any) {
        // Keep the legacy file so the migration retries on the next boot. The points
        // are still in the returned map, so this session does not lose them either.
        this.lastSaveError = err?.message ?? String(err)
        return migrated
      }
    }
    try {
      await rename(this.legacyPath, `${this.legacyPath}.migrated-${Date.now()}`)
    } catch {}
    return migrated
  }

  // ---------------------------------------------------------------- writing

  private mergePoints(key: string, incoming: StoredPoint[]): void {
    if (incoming.length === 0) return
    const existing = this.points.get(key) ?? []
    const byTimestamp = new Map<number, StoredPoint>()
    for (const point of existing) byTimestamp.set(point.timestamp, point)
    for (const point of incoming) byTimestamp.set(point.timestamp, point)
    const merged = Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp)
    const trimmed = this.trimList(merged, cutoffFor())
    if (trimmed.length === 0) this.points.delete(key)
    else this.points.set(key, trimmed)
  }

  private trimList(list: StoredPoint[], cutoff: number): StoredPoint[] {
    let start = 0
    while (start < list.length && list[start]!.timestamp < cutoff) start += 1
    if (start > 0) list.splice(0, start)
    if (list.length > MAX_POINTS_PER_KEY) list.splice(0, list.length - MAX_POINTS_PER_KEY)
    return list
  }

  private trimMemory(cutoff: number): number {
    let removed = 0
    for (const [key, list] of this.points) {
      const before = list.length
      this.trimList(list, cutoff)
      removed += before - list.length
      if (list.length === 0) this.points.delete(key)
    }
    return removed
  }

  private appendPoint(key: string, point: StoredPoint, cutoff: number, lines: string[]): void {
    let list = this.points.get(key)
    if (!list) {
      list = []
      this.points.set(key, list)
    }
    const last = list[list.length - 1]
    if (
      last &&
      point.timestamp - last.timestamp < DEDUPE_WINDOW_MS &&
      last.kind === point.kind &&
      last.remainingPercent === point.remainingPercent &&
      last.remainingBalance === point.remainingBalance
    ) {
      return
    }
    if (list.length > 0 && list[0]!.timestamp < cutoff) this.trimList(list, cutoff)
    list.push(point)
    if (list.length > MAX_POINTS_PER_KEY) list.splice(0, list.length - MAX_POINTS_PER_KEY)
    lines.push(encodePoint(key, point))
  }

  /**
   * Journal the new points carried by a round of cards.
   *
   * Only changed points are appended (5-minute dedupe, balance changes bypass it),
   * and nothing is serialized to disk synchronously: the lines are queued and
   * coalesced into one async `appendFile`.
   */
  recordSnapshots(cards: AuthCardItem[]): void {
    const now = Date.now()
    const cutoff = cutoffFor()
    const lines: string[] = []

    for (const card of cards) {
      if (!card || card.status === 'disabled' || card.status === 'error') continue

      let representative: StoredPoint | undefined

      for (const group of card.groups ?? []) {
        for (const win of group.windows ?? []) {
          if (win.status === 'disabled' || win.status === 'unknown') continue
          if (!isQuantified(win)) continue
          const point: StoredPoint = {
            timestamp: now,
            kind: 'usage',
            remainingPercent: win.remainingPercent,
            usedPercent: win.usedPercent,
            resetAt: win.resetAt,
          }
          const key = `${card.id}::${group.id || group.title}::${win.id}`
          this.appendPoint(key, point, cutoff, lines)
          if (!representative) {
            representative = { timestamp: now, kind: 'usage', remainingPercent: win.remainingPercent, usedPercent: win.usedPercent, resetAt: win.resetAt }
          }
        }
      }

      // Card-level series keeps the overview/backward-compatible key. Prefer the first
      // quantified window; otherwise fall back to a balance amount, never a made-up ratio.
      if (!representative && typeof card.balance?.remaining === 'number' && Number.isFinite(card.balance.remaining)) {
        representative = { timestamp: now, kind: 'balance', remainingBalance: card.balance.remaining }
      }
      if (representative) this.appendPoint(card.id, representative, cutoff, lines)
    }

    if (lines.length === 0) return
    this.pendingLines.push(...lines)
    if (this.pendingLines.length >= FLUSH_EAGER_LINES) void this.flush()
    else this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, FLUSH_DELAY_MS)
    if (typeof (this.flushTimer as any).unref === 'function') (this.flushTimer as any).unref()
  }

  /** Append every queued line; resolves true when the journal is up to date. */
  async flush(): Promise<boolean> {
    if (this.flushPromise) return this.flushPromise
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const lines = this.pendingLines.splice(0)
    if (lines.length === 0) return true

    this.flushPromise = (async () => {
      try {
        await appendFile(this.journalPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
        this.lastSaveError = undefined
        return true
      } catch (err: any) {
        this.pendingLines.unshift(...lines)
        this.lastSaveError = err?.message ?? String(err)
        return false
      } finally {
        this.flushPromise = null
        if (this.pendingLines.length > 0) this.scheduleFlush()
      }
    })()
    return this.flushPromise
  }

  private flushSync(): boolean {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.pendingLines.length === 0) return true
    const lines = this.pendingLines.splice(0)
    try {
      appendFileSync(this.journalPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
      this.lastSaveError = undefined
      return true
    } catch (err: any) {
      this.pendingLines.unshift(...lines)
      this.lastSaveError = err?.message ?? String(err)
      return false
    }
  }

  /** Backward-compatible name for a synchronous flush (the old full rewrite). */
  save(): boolean {
    return this.flushSync()
  }

  get persistenceDegraded(): boolean {
    return this.lastSaveError !== undefined
  }

  get lastError(): string | undefined {
    return this.lastSaveError
  }

  // ------------------------------------------------------------- compaction

  /** Trim (30 days / 2000 points) then atomically rewrite the journal; keeps a `.bak`. */
  async compact(): Promise<boolean> {
    await this.ready
    return this.compactNow()
  }

  private async journalSize(): Promise<number> {
    try {
      return (await stat(this.journalPath)).size
    } catch {
      return -1
    }
  }

  private async compactNow(): Promise<boolean> {
    if (this.compactPromise) return this.compactPromise
    this.compactPromise = (async () => {
      try {
        await this.flush()
        const existed = existsSync(this.journalPath)
        // -1 means "no journal yet"; a concurrent writer creating it still changes the value.
        const beforeSize = await this.journalSize()
        this.trimMemory(cutoffFor())

        const lines: string[] = []
        for (const [key, list] of this.points) {
          for (const point of list) lines.push(encodePoint(key, point))
        }

        if (existed) {
          try {
            await copyFile(this.journalPath, `${this.journalPath}.bak`)
          } catch {}
        }

        const tmpPath = `${this.journalPath}.${process.pid}.${Date.now()}.tmp`
        await writeFile(tmpPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 })

        // A concurrent writer (another process) appended while we were serializing:
        // do not clobber its lines; skip this compaction and retry on the next tick.
        const afterSize = await this.journalSize()
        if (afterSize !== beforeSize) {
          await unlink(tmpPath).catch(() => {})
          return false
        }

        await rename(tmpPath, this.journalPath)
        this.lastSaveError = undefined
        return true
      } catch (err: any) {
        this.lastSaveError = err?.message ?? String(err)
        return false
      } finally {
        this.compactPromise = null
      }
    })()
    return this.compactPromise
  }

  // ----------------------------------------------------------------- reading

  private keyParts(key: string): { instanceId: string; poolId?: string; windowId?: string } {
    const [instanceId, poolId, windowId] = key.split('::')
    return { instanceId: instanceId ?? key, poolId, windowId }
  }

  getTrendPoints(instanceIdOrKey: string, days = 7): QuotaHistoryPoint[] {
    const list = this.points.get(instanceIdOrKey)
    if (!list || list.length === 0) return []
    const cutoff = Date.now() - days * DAY_MS
    const { instanceId, poolId, windowId } = this.keyParts(instanceIdOrKey)
    const out: QuotaHistoryPoint[] = []
    for (const point of list) {
      if (point.timestamp < cutoff) continue
      out.push({
        timestamp: point.timestamp,
        instanceId,
        ...(poolId !== undefined ? { poolId } : {}),
        ...(windowId !== undefined ? { windowId } : {}),
        ...(point.kind !== undefined ? { kind: point.kind } : {}),
        ...(point.remainingPercent !== undefined ? { remainingPercent: point.remainingPercent } : {}),
        ...(point.usedPercent !== undefined ? { usedPercent: point.usedPercent } : {}),
        ...(point.remainingBalance !== undefined ? { remainingBalance: point.remainingBalance } : {}),
        ...(point.resetAt !== undefined ? { resetAt: point.resetAt } : {}),
      } as QuotaHistoryPoint)
    }
    return out
  }

  getUsageTrendPoints(instanceIdOrKey: string, days = 7): Array<{ t: number; r: number }> {
    const list = this.points.get(instanceIdOrKey) ?? []
    const now = Date.now()
    const startTime = now - days * DAY_MS
    const recentPoints = list.filter((point) => point.timestamp >= startTime)

    const numBins = 7
    const binDuration = (days * DAY_MS) / numBins
    const usageBins: number[] = new Array(numBins).fill(0)

    if (recentPoints.length >= 2) {
      for (let i = 1; i < recentPoints.length; i += 1) {
        const prev = recentPoints[i - 1]!
        const curr = recentPoints[i]!
        const binIndex = Math.min(numBins - 1, Math.max(0, Math.floor((curr.timestamp - startTime) / binDuration)))

        if (prev.remainingBalance !== undefined && curr.remainingBalance !== undefined) {
          const deltaBalance = prev.remainingBalance - curr.remainingBalance
          if (deltaBalance > 0) usageBins[binIndex]! += deltaBalance
        } else {
          if (prev.remainingPercent === undefined || curr.remainingPercent === undefined) continue
          // A reset (remaining increased) is a top-up/renewal, not negative usage.
          if (curr.remainingPercent > prev.remainingPercent) continue
          const prevUsed = prev.usedPercent ?? 100 - prev.remainingPercent
          const currUsed = curr.usedPercent ?? 100 - curr.remainingPercent
          const deltaUsed = currUsed - prevUsed
          if (deltaUsed > 0) usageBins[binIndex]! += deltaUsed
        }
      }
    }

    const maxUsage = Math.max(...usageBins)
    const points: Array<{ t: number; r: number }> = []
    for (let i = 0; i < numBins; i += 1) {
      const binTime = startTime + i * binDuration + binDuration / 2
      if (maxUsage <= 0) {
        points.push({ t: binTime, r: 0 })
      } else {
        const value = usageBins[i]!
        const normalized = value > 0 ? Math.min(100, Math.round((value / maxUsage) * 85 + 10)) : 0
        points.push({ t: binTime, r: normalized })
      }
    }
    return points
  }

  calculateBurnRate(
    instanceIdOrKey: string,
    currentRemainingPercent: number,
  ): { burnRatePerHour?: number; estimatedHoursLeft?: number } {
    const list = this.points.get(instanceIdOrKey) ?? []
    if (list.length < 2) return {}

    const now = Date.now()
    const oneDayAgo = now - DAY_MS
    // Burn rate is a percentage-per-hour figure: only real `usage` ratios qualify.
    const recentPoints = list.filter(
      (point) =>
        point.timestamp >= oneDayAgo &&
        point.kind !== 'balance' &&
        typeof point.remainingPercent === 'number' &&
        Number.isFinite(point.remainingPercent),
    )
    if (recentPoints.length < 2) return {}

    const firstPoint = recentPoints[0]!
    const lastPoint = recentPoints[recentPoints.length - 1]!
    const first = firstPoint.remainingPercent!
    const last = lastPoint.remainingPercent!
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / (3600 * 1000)
    if (timeDiffHours < 0.25) return {}

    // A reset or top-up inside the sample makes a single linear rate meaningless.
    if (last > first) return {}

    const deltaUsed = Math.max(0, first - last)
    const burnRatePerHour = Math.round((deltaUsed / timeDiffHours) * 100) / 100

    let estimatedHoursLeft: number | undefined
    if (burnRatePerHour > 0.01 && currentRemainingPercent > 0) {
      estimatedHoursLeft = Math.round((currentRemainingPercent / burnRatePerHour) * 10) / 10
    }
    return { burnRatePerHour, estimatedHoursLeft }
  }
}
