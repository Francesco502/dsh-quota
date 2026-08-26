import type { IQuotaProvider, QuotaConfig, ProviderResult, AuthCardItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

interface CursorLogin {
  accessToken: string
  userId: string
  email?: string
  membershipType?: string
}

export class CursorProvider implements IQuotaProvider {
  name = 'cursor'

  private databasePaths(): string[] {
    const home = homedir()
    const paths: string[] = []
    if (platform() === 'win32' && process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    } else if (platform() === 'darwin') {
      paths.push(join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    } else {
      paths.push(join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
      paths.push('/mnt/c/Users/81017/AppData/Roaming/Cursor/User/globalStorage/state.vscdb')
      if (process.env.USERPROFILE) paths.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    }
    return [...new Set(paths)]
  }

  private findLocalLogin(): CursorLogin | null {
    for (const path of this.databasePaths()) {
      if (!existsSync(path)) continue
      try {
        const db = new DatabaseSync(path, { readOnly: true })
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'").all() as Array<{ key: string; value: string }>
        db.close()
        const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
        const accessToken = values['cursorAuth/accessToken']?.trim()
        const userId = values['cursorAuth/stripeMembershipAuthId']?.trim()
        if (accessToken && userId) {
          return {
            accessToken,
            userId,
            email: values['cursorAuth/cachedEmail'],
            membershipType: values['cursorAuth/stripeMembershipType'],
          }
        }
      } catch {}
    }
    return null
  }

  async fetchCard(config: QuotaConfig): Promise<ProviderResult> {
    let cookie = ''
    let email: string | undefined
    let membershipType: string | undefined

    if (config.cursor?.sessionToken?.trim()) {
      const tokenInput = config.cursor.sessionToken.trim()
      cookie = tokenInput.startsWith('WorkosCursorSessionToken=') ? tokenInput : `WorkosCursorSessionToken=${tokenInput}`
    } else {
      const login = this.findLocalLogin()
      if (login) {
        cookie = `WorkosCursorSessionToken=${login.userId}::${login.accessToken}`
        email = login.email
        membershipType = login.membershipType
      }
    }

    if (!cookie) {
      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: 'disabled',
          error: '未连接 Cursor。请点击「连接 Cursor」自动读取本地登录，或在设置中手动填入 Session',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers = { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
      const [usageRes, stripeRes] = await Promise.all([
        fetch('https://cursor.com/api/usage-summary', { headers }),
        fetch('https://cursor.com/api/auth/stripe', { headers }),
      ])
      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`)
      const data = await usageRes.json() as any
      const stripe = stripeRes.ok ? await stripeRes.json() as any : {}
      const plan = data.individualUsage?.plan
      if (!plan?.enabled) throw new Error('Cursor 当前账户未返回可用订阅额度')

      // Exact values matching Cursor's official dashboard:
      // 1. autoPercentUsed (e.g. 49% used -> "Cursor Models · Includes Cursor Grok and Composer")
      // 2. apiPercentUsed / totalPercentUsed (e.g. 65% used -> "Other Models")
      const autoPercent = Math.max(0, Math.min(100, Math.round(plan.autoPercentUsed ?? plan.totalPercentUsed ?? 0)))
      const apiPercent = Math.max(0, Math.min(100, Math.round(plan.apiPercentUsed ?? 0)))
      const autoRemaining = Math.max(0, 100 - autoPercent)
      const apiRemaining = Math.max(0, 100 - apiPercent)

      let resetTimestamp: number | undefined
      if (stripe?.currentPeriodEnd) {
        resetTimestamp = stripe.currentPeriodEnd * 1000
      } else if (data?.startOfMonth) {
        const d = new Date()
        d.setMonth(d.getMonth() + 1, 1)
        d.setHours(0, 0, 0, 0)
        resetTimestamp = d.getTime()
      }

      const autoSubtitle = resetTimestamp
        ? formatQuotaResetText(resetTimestamp, autoPercent, true)
        : (autoRemaining < 100 ? `已用 ${autoPercent}% · 包含 Composer / Grok` : '已用 0% · 额度充足')

      const apiSubtitle = apiRemaining < 100
        ? `已用 ${apiPercent}% · 包含 $20 API 用量`
        : '已用 0% · 额度充足'

      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: autoRemaining <= 15 ? 'warn' : 'ok',
          plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? 'Cursor').toUpperCase(),
          account: email || stripe.paymentId,
          groups: [
            {
              title: 'Cursor Plan Usage',
              windows: [
                {
                  id: 'cursor-auto',
                  label: 'Fast Requests (Cursor 核心模型)',
                  subtitle: autoSubtitle,
                  usedPercent: autoPercent,
                  remainingPercent: autoRemaining,
                  barType: 'circle',
                },
                {
                  id: 'cursor-named',
                  label: 'Other Models (其他通用模型)',
                  subtitle: apiSubtitle,
                  usedPercent: apiPercent,
                  remainingPercent: apiRemaining,
                  barType: 'circle',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
        },
      }
    } catch (err: any) {
      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: 'error',
          plan: '已连接',
          account: email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
