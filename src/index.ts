/**
 * Host loader entry for dsh-quota plugin.
 * @package dsh-quota
 * @version 0.1.0
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { QuotaManager } from './core/manager.ts'
import { makeQuotaRoutes } from './routes.ts'

export const VERSION = '0.1.0'
export const inject = ['systemPrompt', 'webServer']

const GUIDANCE = '本机已安装 dsh-quota 插件（DSH AI 额度与用量监控）：侧边栏「额度监控」入口。能力：集中监控并展示 Codex、Cursor、Google Antigravity、OpenCode-Go 等服务的实时剩余额度、用量及到期重置周期；支持从本地 Cursor 数据库自动读取凭据，或在界面中配置 API Key。用户提到「额度 / 余额 / quota / Token 剩余 / Cursor 额度 / Codex 额度 / 用量」时即指本插件，请据此协作。'

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
}
