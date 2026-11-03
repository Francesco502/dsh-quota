import type { AuthCardItem, QuotaAlarm } from './types.ts'

export class QuotaAlarmDetector {
  private activeAlarms: Map<string, QuotaAlarm> = new Map()

  detectAlarms(cards: AuthCardItem[], thresholdPercent = 15): QuotaAlarm[] {
    const alarms: QuotaAlarm[] = []
    const now = Date.now()

    for (const card of cards) {
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

      // Check min remaining percentage across groups & windows
      let lowestRemaining = 100
      let lowestLabel = ''
      let lowestPoolId: string | undefined
      let lowestWinId: string | undefined
      let lowestAmountText: string | undefined

      for (const group of card.groups) {
        for (const win of group.windows) {
          if (win.status === 'disabled' || win.status === 'unknown') continue
          if (win.remainingPercent < lowestRemaining) {
            lowestRemaining = win.remainingPercent
            lowestLabel = `${group.title} · ${win.label}`
            lowestPoolId = group.id || group.poolType
            lowestWinId = win.id
            lowestAmountText = win.amountText
          }
        }
      }

      if (card.balance?.remaining !== undefined && card.balance?.total && card.balance.total > 0) {
        const balPercent = (card.balance.remaining / card.balance.total) * 100
        if (balPercent < lowestRemaining) {
          lowestRemaining = balPercent
          lowestLabel = '账户可用余额'
          lowestPoolId = 'balance'
          lowestWinId = 'account-balance'
          lowestAmountText = undefined
        }
      }

      if (lowestRemaining <= thresholdPercent) {
        const isCritical = lowestRemaining <= 5
        // A balance window reports money, not a percentage the plugin invented.
        const amountSuffix = lowestAmountText
          ? `余额 ${lowestAmountText}`
          : `剩余 ${Math.round(lowestRemaining)}%`
        const alarm: QuotaAlarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: lowestPoolId,
          windowId: lowestWinId,
          level: isCritical ? 'critical' : 'warn',
          message: `${card.name}: ${lowestLabel} ${amountSuffix}${isCritical ? ' (即将用尽)' : ' (低于阈值)'}`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
      } else {
        this.activeAlarms.delete(card.id)
      }
    }

    return alarms
  }

  getActiveAlarms(): QuotaAlarm[] {
    return Array.from(this.activeAlarms.values())
  }
}
