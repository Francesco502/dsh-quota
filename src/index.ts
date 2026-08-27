/**
 * Host loader entry for dsh-quota plugin.
 * @package dsh-quota
 * @version 0.2.2
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { QuotaManager } from './core/manager.ts'
import { makeQuotaRoutes } from './routes.ts'

export const VERSION = '0.2.2'
export const inject = ['systemPrompt', 'webServer']

const GUIDANCE = '本机已安装 dsh-quota 插件（DSH AI 额度与用量监控 v0.2.2）：侧边栏「额度监控」入口。能力：集中监控并展示 DeepSeek、Cursor、Codex、Google Antigravity、GitHub Copilot、OpenAI Billing、Claude、Kimi、智谱 GLM、MiniMax、通义千问、火山方舟、OpenCode-Go 及 OneAPI 中转服务的实时剩余额度、用量及到期重置周期；支持 7 天时序趋势 Sparkline、消耗速率计算、一键全部测活与多账号中转管理。在长程编码任务启动前或用户询问额度/模型选择时，可调用 get_quota_status 自动获取各模型实时余量与智能路由推荐。'

export function apply(ctx: Context): void {
  const manager = new QuotaManager()

  // Register routes
  ctx.effect(() => {
    const routes = makeQuotaRoutes(manager)
    const disposers: Array<() => void> = []
    for (const r of routes) {
      disposers.push(ctx.webServer.register(r))
    }
    return () => {
      for (const d of disposers) d()
    }
  }, 'quota: routes')

  // Register system prompt guidance
  ctx.effect(() => {
    return ctx.systemPrompt.section({
      name: 'plugin:quota-monitor',
      order: 210,
      text: GUIDANCE,
    })
  }, 'quota: system prompt')

  // Register Agent Tool get_quota_status
  try {
    if ((ctx as any).agent && typeof (ctx as any).agent.registerTool === 'function') {
      ctx.effect(() => {
        return (ctx as any).agent.registerTool({
          name: 'get_quota_status',
          description: '查询当前配置的所有 AI 服务的实时剩余额度、余额、告警状态以及智能模型推荐路由。',
          parameters: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                description: '可选：指定查询的 Provider 名称或实例 ID（如 deepseek, cursor, antigravity, kimi, glm, qwen）',
              },
              forceRefresh: {
                type: 'boolean',
                description: '是否强制从各官方 API 重新拉取最新数据（默认 false 使用缓存）',
              },
            },
          },
          handler: async (args: { provider?: string; forceRefresh?: boolean }) => {
            return manager.getAgentQuotaSummary(args.provider, args.forceRefresh)
          },
        })
      }, 'quota: agent tool')
    }
  } catch {}
}
