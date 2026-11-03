import type { AuthCardItem, QuotaHistoryPoint } from './types.ts'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { atomicWriteJsonSync } from './paths.ts'

interface HistoryStoreData {
  version: number
  records: Record<string, QuotaHistoryPoint[]> // instanceId or metricKey -> points
}

export class QuotaHistoryManager {
  private historyPath: string
  private records: Map<string, QuotaHistoryPoint[]> = new Map()
  private maxDays = 30
  private lastSaveTime = 0

  constructor() {
    const dshDir = process.env.DSH_HOME || join(homedir(), '.dsh')
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
        version: 2,
        records: Object.fromEntries(this.records.entries()),
      }
      atomicWriteJsonSync(this.historyPath, obj, 0o600)
      this.lastSaveTime = Date.now()
    } catch {}
  }

  private appendPoint(key: string, point: QuotaHistoryPoint, cutoff: number, isBalanceChanged = false): void {
    let list = this.records.get(key)
    if (!list) {
      list = []
      this.records.set(key, list)
    }

    const lastPoint = list[list.length - 1]
    if (
      lastPoint &&
      point.timestamp - lastPoint.timestamp < 5 * 60 * 1000 &&
      lastPoint.remainingPercent === point.remainingPercent &&
      !isBalanceChanged
    ) {
      return
    }

    list.push(point)

    if (list.length > 2000 || (list[0] && list[0].timestamp < cutoff)) {
      const filtered = list.filter((p) => p.timestamp >= cutoff)
      this.records.set(key, filtered)
    }
  }

  recordSnapshots(cards: AuthCardItem[]): void {
    const now = Date.now()
    const cutoff = now - this.maxDays * 24 * 3600 * 1000

    for (const card of cards) {
      if (card.status === 'disabled' || card.status === 'error') continue

      // 1. Record individual window-level points
      for (const group of card.groups) {
        for (const win of group.windows) {
          if (win.status === 'disabled' || win.status === 'unknown') continue
          const winKey = `${card.id}::${group.id || group.title}::${win.id}`
          const winPoint: QuotaHistoryPoint = {
            timestamp: now,
            instanceId: card.id,
            poolId: group.id || group.poolType,
            windowId: win.id,
            windowKind: win.windowKind,
            remainingPercent: win.remainingPercent,
            usedPercent: win.usedPercent,
            resetAt: win.resetAt,
          }
          this.appendPoint(winKey, winPoint, cutoff)
        }
      }

      // 2. Record card-level representative point for backward compatibility and overview
      let remPercent = 100
      let usedPercent = 0
      let representativeResetAt: string | undefined

      if (card.groups.length > 0 && card.groups[0]?.windows.length) {
        const win = card.groups[0].windows[0]
        if (win) {
          remPercent = win.remainingPercent
          usedPercent = win.usedPercent
          representativeResetAt = win.resetAt
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
        resetAt: representativeResetAt,
      }

      const isBalanceChanged =
        card.balance?.remaining !== undefined &&
        (() => {
          const l = this.records.get(card.id)
          const lp = l ? l[l.length - 1] : undefined
          return lp ? lp.remainingBalance !== card.balance.remaining : false
        })()

      this.appendPoint(card.id, point, cutoff, isBalanceChanged)
    }

    // Debounced disk write every 2 minutes
    if (now - this.lastSaveTime > 2 * 60 * 1000) {
      this.save()
    }
  }

  getTrendPoints(instanceIdOrKey: string, days = 7): QuotaHistoryPoint[] {
    const list = this.records.get(instanceIdOrKey) || []
    const cutoff = Date.now() - days * 24 * 3600 * 1000
    return list.filter((p) => p.timestamp >= cutoff)
  }

  getUsageTrendPoints(instanceIdOrKey: string, days = 7): Array<{ t: number; r: number }> {
    const list = this.records.get(instanceIdOrKey) || []
    const now = Date.now()
    const startTime = now - days * 24 * 3600 * 1000
    const recentPoints = list.filter((p) => p.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp)

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
          // If reset occurred (remaining increased), don't count delta as usage
          if (curr.remainingPercent > prev.remainingPercent) {
            continue
          }
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

  calculateBurnRate(
    instanceIdOrKey: string,
    currentRemainingPercent: number
  ): { burnRatePerHour?: number; estimatedHoursLeft?: number } {
    const list = this.records.get(instanceIdOrKey) || []
    if (list.length < 2) return {}

    const now = Date.now()
    const oneDayAgo = now - 24 * 3600 * 1000
    const recentPoints = list.filter((p) => p.timestamp >= oneDayAgo)

    if (recentPoints.length < 2) return {}

    const firstPoint = recentPoints[0]!
    const lastPoint = recentPoints[recentPoints.length - 1]!
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / (3600 * 1000)

    if (timeDiffHours < 0.25) return {} // Need at least 15 min of sample

    // Check if reset occurred between first and last sample
    if (lastPoint.remainingPercent > firstPoint.remainingPercent) {
      return {} // Quota was reset or topped up during this period, cannot calculate single linear burn
    }

    const deltaUsed = Math.max(0, firstPoint.remainingPercent - lastPoint.remainingPercent)
    const burnRatePerHour = Math.round((deltaUsed / timeDiffHours) * 100) / 100

    let estimatedHoursLeft: number | undefined
    if (burnRatePerHour > 0.01 && currentRemainingPercent > 0) {
      estimatedHoursLeft = Math.round((currentRemainingPercent / burnRatePerHour) * 10) / 10
    }

    return { burnRatePerHour, estimatedHoursLeft }
  }
}
