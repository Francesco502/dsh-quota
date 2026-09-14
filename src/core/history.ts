import type { AuthCardItem, QuotaHistoryPoint } from './types.ts'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { atomicWriteJsonSync } from './paths.ts'

interface HistoryStoreData {
  version: number
  records: Record<string, QuotaHistoryPoint[]> // instanceId -> points
}

export class QuotaHistoryManager {
  private historyPath: string
  private records: Map<string, QuotaHistoryPoint[]> = new Map()
  private maxDays = 30
  private lastSaveTime = 0

  constructor() {
    const home = homedir()
    const dshDir = join(home, '.dsh')
    if (!existsSync(dshDir)) {
      try {
        mkdirSync(dshDir, { recursive: true })
      } catch {}
    }
    this.historyPath = join(dshDir, 'quota-history.json')
    this.load()
  }

  load(): void {
    try {
      if (existsSync(this.historyPath)) {
        const raw = readFileSync(this.historyPath, 'utf8')
        const data = JSON.parse(raw) as HistoryStoreData
        this.records.clear()
        if (data && data.records) {
          for (const [key, list] of Object.entries(data.records)) {
            if (Array.isArray(list)) {
              this.records.set(key, list)
            }
          }
        }
      }
    } catch {}
  }

  save(): void {
    try {
      const obj: HistoryStoreData = {
        version: 1,
        records: Object.fromEntries(this.records.entries()),
      }
      atomicWriteJsonSync(this.historyPath, obj, 0o600)
      this.lastSaveTime = Date.now()
    } catch {}
  }

  recordSnapshots(cards: AuthCardItem[]): void {
    const now = Date.now()
    const cutoff = now - this.maxDays * 24 * 3600 * 1000

    for (const card of cards) {
      if (card.status === 'disabled' || card.status === 'error') continue
      
      // Calculate representative remaining / used percent
      let remPercent = 100
      let usedPercent = 0
      
      if (card.groups.length > 0 && card.groups[0]?.windows.length) {
        const win = card.groups[0].windows[0]
        if (win) {
          remPercent = win.remainingPercent
          usedPercent = win.usedPercent
        }
      } else if (card.balance?.remaining !== undefined && card.balance?.total) {
        remPercent = Math.max(0, Math.min(100, Math.round((card.balance.remaining / card.balance.total) * 100)))
        usedPercent = 100 - remPercent
      }

      const point: QuotaHistoryPoint = {
        timestamp: now,
        instanceId: card.id,
        remainingPercent: remPercent,
        usedPercent,
        remainingBalance: card.balance?.remaining,
      }

      let list = this.records.get(card.id)
      if (!list) {
        list = []
        this.records.set(card.id, list)
      }

      // Avoid duplicate points within 5 minutes if value hasn't changed
      const lastPoint = list[list.length - 1]
      const isBalanceChanged = card.balance?.remaining !== undefined && lastPoint && lastPoint.remainingBalance !== card.balance.remaining
      if (lastPoint && (now - lastPoint.timestamp < 5 * 60 * 1000) && lastPoint.remainingPercent === point.remainingPercent && !isBalanceChanged) {
        continue
      }

      list.push(point)

      // Prune outdated entries
      if (list.length > 2000 || (list[0] && list[0].timestamp < cutoff)) {
        const filtered = list.filter(p => p.timestamp >= cutoff)
        this.records.set(card.id, filtered)
      }
    }

    // Debounced disk write every 2 minutes
    if (now - this.lastSaveTime > 2 * 60 * 1000) {
      this.save()
    }
  }

  getTrendPoints(instanceId: string, days = 7): QuotaHistoryPoint[] {
    const list = this.records.get(instanceId) || []
    const cutoff = Date.now() - days * 24 * 3600 * 1000
    return list.filter(p => p.timestamp >= cutoff)
  }

  /**
   * Calculates recent usage activity trend points (7 days, daily bins).
   * Returns normalized 0~100 activity values representing usage change.
   */
  getUsageTrendPoints(instanceId: string, days = 7): Array<{ t: number; r: number }> {
    const list = this.records.get(instanceId) || []
    const now = Date.now()
    const startTime = now - days * 24 * 3600 * 1000
    const recentPoints = list.filter(p => p.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp)

    const numBins = 7
    const binDuration = (days * 24 * 3600 * 1000) / numBins
    const usageBins: number[] = new Array(numBins).fill(0)

    if (recentPoints.length >= 2) {
      for (let i = 1; i < recentPoints.length; i++) {
        const prev = recentPoints[i - 1]!
        const curr = recentPoints[i]!
        const binIndex = Math.min(numBins - 1, Math.max(0, Math.floor((curr.timestamp - startTime) / binDuration)))

        if (prev.remainingBalance !== undefined && curr.remainingBalance !== undefined) {
          const deltaBal = prev.remainingBalance - curr.remainingBalance
          if (deltaBal > 0) {
            usageBins[binIndex] += deltaBal
          }
        } else {
          const prevUsed = prev.usedPercent ?? (100 - prev.remainingPercent)
          const currUsed = curr.usedPercent ?? (100 - curr.remainingPercent)
          const deltaUsed = currUsed - prevUsed
          if (deltaUsed > 0) {
            usageBins[binIndex] += deltaUsed
          }
        }
      }
    }

    const maxUsage = Math.max(...usageBins)
    const points: Array<{ t: number; r: number }> = []

    for (let i = 0; i < numBins; i++) {
      const binTime = startTime + i * binDuration + binDuration / 2
      if (maxUsage <= 0) {
        points.push({ t: binTime, r: 0 })
      } else {
        const val = usageBins[i]!
        const normalized = val > 0 ? Math.min(100, Math.round((val / maxUsage) * 85 + 10)) : 0
        points.push({ t: binTime, r: normalized })
      }
    }

    return points
  }

  /**
   * Calculates consumption rate (% / hour) and estimated remaining hours.
   */
  calculateBurnRate(instanceId: string, currentRemainingPercent: number): { burnRatePerHour?: number; estimatedHoursLeft?: number } {
    const list = this.records.get(instanceId) || []
    if (list.length < 2) return {}

    const now = Date.now()
    const oneDayAgo = now - 24 * 3600 * 1000
    const recentPoints = list.filter(p => p.timestamp >= oneDayAgo)

    if (recentPoints.length < 2) return {}

    const firstPoint = recentPoints[0]!
    const lastPoint = recentPoints[recentPoints.length - 1]!
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / (3600 * 1000)

    if (timeDiffHours < 0.25) return {} // Need at least 15 min of sample

    // Used percent delta
    const deltaUsed = Math.max(0, firstPoint.remainingPercent - lastPoint.remainingPercent)
    const burnRatePerHour = Math.round((deltaUsed / timeDiffHours) * 100) / 100

    let estimatedHoursLeft: number | undefined
    if (burnRatePerHour > 0.01 && currentRemainingPercent > 0) {
      estimatedHoursLeft = Math.round((currentRemainingPercent / burnRatePerHour) * 10) / 10
    }

    return { burnRatePerHour, estimatedHoursLeft }
  }
}
