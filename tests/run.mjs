import assert from 'node:assert/strict'
import {
  formatQuotaResetText,
  QuotaManager,
  getRefreshIntervalSeconds,
  DeepSeekProvider,
  CursorProvider,
  CodexProvider,
  AntigravityProvider,
  GitHubCopilotProvider,
  OpenAIBillingProvider,
  ClaudeProvider,
  KimiProvider,
  GLMProvider,
  MiniMaxProvider,
  QwenProvider,
  VolcengineProvider,
  OpenCodeGoProvider,
  CustomApiProvider,
} from '../lib/index.js'
import { readFileSync } from 'node:fs'

console.log('Running dsh-quota v0.2.2 test suite...')

// 1. Percentage calculation
const calcPercent = (used, total) => {
  if (!total || total <= 0) return 0
  const pct = Math.round((used / total) * 100)
  return Math.max(0, Math.min(100, pct))
}

assert.equal(calcPercent(50, 100), 50)
assert.equal(calcPercent(150, 100), 100)
assert.equal(calcPercent(-10, 100), 0)
assert.equal(calcPercent(0, 0), 0)
console.log('✓ calcPercent passed')

// 2. Format reset countdown (Standard English labels)
assert.equal(formatQuotaResetText(undefined, 0), '已用 0% · 额度充足')
assert.match(formatQuotaResetText(new Date(Date.now() + 3600 * 1000 * 5), 45, false), /已用 45% · 预计 5 小时.*后重置/)
console.log('✓ formatQuotaResetText passed')

// 3. Polling interval calculations
assert.equal(getRefreshIntervalSeconds(undefined), 60)
assert.equal(getRefreshIntervalSeconds({}), 60)
assert.equal(getRefreshIntervalSeconds({ refreshIntervalSeconds: 10 }), 10)
assert.equal(getRefreshIntervalSeconds({ refreshIntervalSeconds: 30 }), 30)
assert.equal(getRefreshIntervalSeconds({ refreshIntervalSeconds: 60 }), 60)
assert.equal(getRefreshIntervalSeconds({ refreshIntervalMinutes: 5 }), 300)
console.log('✓ polling interval calculation passed')

// 4. Provider instantiation & Registration
const manager = new QuotaManager()
assert.ok(manager, 'QuotaManager instantiated')
assert.ok(new DeepSeekProvider(), 'DeepSeekProvider ok')
assert.ok(new CursorProvider(), 'CursorProvider ok')
assert.ok(new CodexProvider(), 'CodexProvider ok')
assert.ok(new AntigravityProvider(), 'AntigravityProvider ok')
assert.ok(new GitHubCopilotProvider(), 'GitHubCopilotProvider ok')
assert.ok(new OpenAIBillingProvider(), 'OpenAIBillingProvider ok')
assert.ok(new ClaudeProvider(), 'ClaudeProvider ok')
assert.ok(new KimiProvider(), 'KimiProvider ok')
assert.ok(new GLMProvider(), 'GLMProvider ok')
assert.ok(new MiniMaxProvider(), 'MiniMaxProvider ok')
assert.ok(new QwenProvider(), 'QwenProvider ok')
assert.ok(new VolcengineProvider(), 'VolcengineProvider ok')
assert.ok(new OpenCodeGoProvider(), 'OpenCodeGoProvider ok')
assert.ok(new CustomApiProvider(), 'CustomApiProvider ok')
console.log('✓ all 14 providers instantiated successfully')

// 5. Test History and Sparkline generation
const testCards = [
  {
    id: 'deepseek_test',
    name: 'DeepSeek Test',
    provider: 'deepseek',
    category: 'domestic_llm',
    status: 'ok',
    groups: [
      {
        title: 'Balance',
        windows: [{ id: 'w1', label: 'Balance', remainingPercent: 80, usedPercent: 20 }],
      },
    ],
    lastUpdated: Date.now(),
  },
]

manager.historyManager.recordSnapshots(testCards)
const trend = manager.historyManager.getTrendPoints('deepseek_test', 7)
assert.ok(Array.isArray(trend), 'Trend points returned')
console.log('✓ history snapshot recorded')

// 6. Test Alarm Detector
const alarmCards = [
  {
    id: 'alarm_test_1',
    name: 'Alarm Test 1',
    provider: 'cursor',
    category: 'ide',
    status: 'ok',
    groups: [
      {
        title: 'Quota',
        windows: [{ id: 'w1', label: 'Fast Requests', remainingPercent: 10, usedPercent: 90 }],
      },
    ],
    lastUpdated: Date.now(),
  },
  {
    id: 'alarm_test_2',
    name: 'Alarm Test 2',
    provider: 'codex',
    category: 'official_cloud',
    status: 'error',
    error: 'Token expired',
    groups: [],
    lastUpdated: Date.now(),
  },
]

const alarms = manager.alarmDetector.detectAlarms(alarmCards, 15)
assert.equal(alarms.length, 2, 'Should detect 2 alarms (1 low quota, 1 error)')
assert.equal(alarms[0].level, 'warn')
assert.equal(alarms[1].level, 'critical')
console.log('✓ alarm detector passed')

// 7. Test Agent Quota Summary & Model Route Recommendation
const summary = await manager.getAgentQuotaSummary()
assert.ok(summary.success, 'Agent quota summary success')
assert.ok(summary.recommendation, 'Recommendation object present')
assert.ok(typeof summary.recommendation.primaryModel === 'string', 'Primary model string present')
console.log('✓ getAgentQuotaSummary & model routing recommendation passed')

// 8. Test Single & Batch Connection Testing
const testConnRes = await manager.testConnection('deepseek')
assert.equal(testConnRes.ok, false, 'Unconfigured should fail gracefully')
assert.match(testConnRes.message, /未配置/)
console.log('✓ single testConnection passed')

const allTests = await manager.testAllConnections()
assert.ok(typeof allTests === 'object', 'Batch test results returned')
assert.ok('deepseek' in allTests, 'DeepSeek in batch test results')
console.log('✓ batch testAllConnections passed')

// 9. Verify Client Bundle contains Sparkline SVG renderer
const clientBundle = readFileSync('lib/client.js', 'utf8')
assert.ok(clientBundle.includes('renderSparklineSvg'), 'client.js must include renderSparklineSvg')
assert.ok(clientBundle.includes('quota-sparkline-wrap'), 'client.js must include quota-sparkline-wrap')
console.log('✓ client.js Sparkline SVG bundle verified')

console.log('🎉 All dsh-quota v0.2.2 tests passed successfully!')
