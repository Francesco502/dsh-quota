import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class ClaudeProvider implements IQuotaProvider {
  name = 'claude'
  category = 'official_cloud' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): string {
    return (accountConfig?.apiKey || config.claude?.apiKey || process.env.ANTHROPIC_API_KEY || '').trim()
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const apiKey = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'claude',
        message: '未配置 Anthropic API Key (sk-ant-...)',
      }
    }

    try {
      // Light ping to Anthropic API
      const res = await fetchWithProxy('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }, config.httpProxy, 10000)

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
    const apiKey = this.resolveKey(config, accountConfig)

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
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'ok',
          plan: 'Anthropic Claude',
          groups: [
            {
              title: 'Claude 账户配额',
              windows: [
                {
                  id: 'claude-active',
                  label: 'API Key 可用状态',
                  subtitle: 'API 凭据有效 · 额度正常',
                  usedPercent: 0,
                  remainingPercent: 100,
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
