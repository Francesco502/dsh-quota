/**
 * Quota alarms (0.4.1 data-truthfulness rules).
 *
 * A window may only participate in the threshold check when `isQuantified()`
 * accepts it. `liveness` and `unknown` windows mean "we have no quota number",
 * not "the quota is fine", so they never alarm — nor do they suppress a real
 * alarm. `balance` windows carry money/credits: they alarm only once the
 * remaining amount reaches zero (critical), never at a synthesized percent.
 */
import type { AuthCardItem, QuotaAlarm } from './types.ts'
import { isQuantified, windowQuotaKind } from './types.ts'

export interface DetectAlarmOptions {
  /**
   * Drop alarms for instances that are absent from this round. False for a
   * provider-filtered round, where the other instances legitimately didn't run.
   */
  prune?: boolean
}

/** Best-effort numeric value of an `amountText` such as `￥0.00` or `12.4 元`. */
function amountValue(text?: string): number | undefined {
  if (!text) return undefined
  const match = String(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return undefined
  const value = Number(match[0])
  return Number.isFinite(value) ? value : undefined
}

export class QuotaAlarmDetector {
  private activeAlarms: Map<string, QuotaAlarm> = new Map()

  detectAlarms(cards: AuthCardItem[], thresholdPercent = 15, options: DetectAlarmOptions = {}): QuotaAlarm[] {
    const alarms: QuotaAlarm[] = []
    const now = Date.now()
    const liveIds = new Set<string>()

    for (const card of cards) {
      liveIds.add(card.id)
      if (card.status === 'disabled') continue

      if (card.status === 'error') {
        const alarm: QuotaAlarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          level: 'critical',
          message: `${card.name}: 连接异常 (${card.error || '凭据失效'})`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
        continue
      }

      // 1. Balance-only exhaustion is the only legitimate `balance` alarm.
      const balanceAmount = card.balance?.remaining
      if (typeof balanceAmount === 'number' && Number.isFinite(balanceAmount) && balanceAmount <= 0) {
        const alarm: QuotaAlarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: 'balance',
          windowId: 'account-balance',
          level: 'critical',
          message: `${card.name}: 账户余额已用尽${card.balance?.currency ? ` (${card.balance.currency})` : ''}`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
        continue
      }

      // 2. Quantified usage windows only.
      let lowestRemaining: number | undefined
      let lowestLabel = ''
      let lowestPoolId: string | undefined
      let lowestWindowId: string | undefined
      let exhaustedBalanceText: string | undefined

      for (const group of card.groups ?? []) {
        for (const win of group.windows ?? []) {
          if (win.status === 'disabled' || win.status === 'unknown') continue

          if (windowQuotaKind(win) === 'balance') {
            const value = amountValue(win.amountText)
            if (value !== undefined && value <= 0 && !exhaustedBalanceText) exhaustedBalanceText = win.amountText
            continue
          }

          if (!isQuantified(win)) continue
          if (lowestRemaining === undefined || win.remainingPercent < lowestRemaining) {
            lowestRemaining = win.remainingPercent
            lowestLabel = `${group.title} · ${win.label}`
            lowestPoolId = group.id || group.poolType
            lowestWindowId = win.id
          }
        }
      }

      if (exhaustedBalanceText) {
        const alarm: QuotaAlarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: 'balance',
          level: 'critical',
          message: `${card.name}: 余额已用尽 (${exhaustedBalanceText})`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
        continue
      }

      if (lowestRemaining === undefined) {
        // liveness / unknown only: no percentage exists, so there is nothing to compare.
        this.activeAlarms.delete(card.id)
        continue
      }

      if (lowestRemaining <= thresholdPercent) {
        const isCritical = lowestRemaining <= 5
        const alarm: QuotaAlarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: lowestPoolId,
          windowId: lowestWindowId,
          level: isCritical ? 'critical' : 'warn',
          message: `${card.name}: ${lowestLabel} 剩余 ${Math.round(lowestRemaining)}%${isCritical ? ' (即将用尽)' : ' (低于阈值)'}`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
      } else {
        this.activeAlarms.delete(card.id)
      }
    }

    // Ghost cleanup: instances that disappeared from this (full) round leave no alarm behind.
    if (options.prune !== false) {
      for (const id of Array.from(this.activeAlarms.keys())) {
        if (!liveIds.has(id)) this.activeAlarms.delete(id)
      }
    }

    return alarms
  }

  getActiveAlarms(): QuotaAlarm[] {
    return Array.from(this.activeAlarms.values())
  }
}
