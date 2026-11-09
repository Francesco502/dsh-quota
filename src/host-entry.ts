/**
 * Public host entry for @francescoli/dsh-quota.
 *
 * `src/index.ts` stays the Cordis plugin entry (apply/inject). This file re-exports
 * the library surface that tests and downstream tooling import from `lib/index.js`,
 * so the bundle keeps the same named exports the previous hand-concatenated build had.
 *
 * @package dsh-quota
 * @version 0.4.4
 */
export { apply, inject, VERSION } from './index.ts'

export {
  QuotaManager,
  runWithConcurrency,
  DEFAULT_PROVIDER_ORDER,
  PROVIDER_DEFAULT_MODELS,
} from './core/manager.ts'
export { fetchWithProxy, sanitizeProxyUrl } from './core/fetch.ts'
export { atomicWriteJsonSync } from './core/paths.ts'
export {
  PLUGIN_VERSION,
  formatQuotaResetText,
  getRefreshIntervalSeconds,
  windowQuotaKind,
  isQuantified,
} from './core/types.ts'

export { DeepSeekProvider } from './providers/deepseek.ts'
export { CursorProvider } from './providers/cursor.ts'
export { CodexProvider } from './providers/codex.ts'
export { AntigravityProvider } from './providers/antigravity.ts'
export { GitHubCopilotProvider } from './providers/copilot.ts'
export { OpenAIBillingProvider } from './providers/openai-billing.ts'
export { ClaudeProvider } from './providers/claude.ts'
export { KimiProvider } from './providers/kimi.ts'
export { GLMProvider } from './providers/glm.ts'
export { MiniMaxProvider } from './providers/minimax.ts'
export { QwenProvider } from './providers/qwen.ts'
export { VolcengineProvider } from './providers/volcengine.ts'
export { SiliconFlowProvider } from './providers/siliconflow.ts'
export { OpenRouterProvider } from './providers/openrouter.ts'
export { OpenCodeGoProvider } from './providers/opencode-go.ts'
export { CustomApiProvider } from './providers/custom-api.ts'
