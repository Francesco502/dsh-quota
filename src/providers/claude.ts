import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class ClaudeProvider implements IQuotaProvider {
  name = 'claude'
  category = 'official_cloud' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.claude?.apiKey || '')).trim()
    const baseUrl = (accountConfig?.baseUrl || config.claude?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'claude',
        message: '未配置 Anthropic API Key (sk-ant-...)',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        redirect: 'error',
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok || res.status === 200) {
        return {
          ok: true,
          provider: 'claude',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'claude',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 60)}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'claude',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'claude'
    const cardName = accountConfig?.name || 'Anthropic Claude'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Anthropic API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        redirect: 'error',
      }, config.httpProxy, 10000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`Claude API 验证失败 (${res.status})`)
      }

      const reqRemaining = res.headers.get('anthropic-ratelimit-requests-remaining')
      const reqLimit = res.headers.get('anthropic-ratelimit-requests-limit')
      let remPercent = 100
      let subtitle = 'API 凭据有效 · 额度正常'

      if (reqRemaining && reqLimit) {
        const rem = parseInt(reqRemaining, 10)
        const lim = parseInt(reqLimit, 10)
        if (lim > 0) {
          remPercent = Math.max(0, Math.min(100, Math.round((rem / lim) * 100)))
          subtitle = `速率余量: ${remPercent}% (${rem}/${lim})`
        }
      }
      const usedPercent = 100 - remPercent

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: remPercent <= 15 ? 'warn' : 'ok',
          plan: 'Anthropic Claude',
          groups: [
            {
              title: 'Claude 账户配额',
              windows: [
                {
                  id: 'claude-active',
                  label: 'API Key 可用状态',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
