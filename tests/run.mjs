import assert from 'node:assert/strict'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'

// Isolate test environment to prevent touching user real .dsh directory
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-quota-test-'))

import {
  formatQuotaResetText,
  QuotaManager,
  fetchWithProxy,
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
  SiliconFlowProvider,
  OpenRouterProvider,
  OpenCodeGoProvider,
  CustomApiProvider,
  atomicWriteJsonSync,
  runWithConcurrency,
  DEFAULT_PROVIDER_ORDER,
} from '../lib/index.js'

console.log('Running dsh-quota v0.3.1 test suite...')

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
assert.ok(new SiliconFlowProvider(), 'SiliconFlowProvider ok')
assert.ok(new OpenRouterProvider(), 'OpenRouterProvider ok')
assert.ok(new OpenCodeGoProvider(), 'OpenCodeGoProvider ok')
assert.ok(new CustomApiProvider(), 'CustomApiProvider ok')
console.log('✓ all 16 providers instantiated successfully')

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
assert.ok(typeof summary.recommendation.primaryModelId === 'string', 'Primary model ID string present')
console.log('✓ getAgentQuotaSummary & model routing recommendation with model ID passed')

// 8. Test Single & Batch Connection Testing
const testConnRes = await manager.testConnection('deepseek', { id: 'deepseek', provider: 'deepseek', apiKey: '' })
assert.equal(testConnRes.ok, false, 'Unconfigured should fail gracefully')
assert.match(testConnRes.message, /未配置/)
console.log('✓ single testConnection passed')

const allTests = await manager.testAllConnections()
assert.ok(typeof allTests === 'object', 'Batch test results returned')
assert.ok('deepseek' in allTests, 'DeepSeek in batch test results')
console.log('✓ batch testAllConnections passed')

// 9. Verify Client Bundle contains Sparkline, Drawer, Table, Switches, Segmented control, and drag-and-drop
const clientBundle = readFileSync('lib/client.js', 'utf8')
assert.ok(clientBundle.includes('renderSparklineSvg'), 'client.js must include renderSparklineSvg')
assert.ok(clientBundle.includes('quota-sparkline-wrap'), 'client.js must include quota-sparkline-wrap')
assert.ok(clientBundle.includes('dsh-drawer'), 'client.js must include Drawer component')
assert.ok(clientBundle.includes('quota-table'), 'client.js must include Table component')
assert.ok(clientBundle.includes('quota-switch'), 'client.js must include Switch component')
assert.ok(clientBundle.includes('quota-segmented'), 'client.js must include Segmented Control component')
assert.ok(clientBundle.includes('cb-show-dashboard'), 'client.js must include cb-show-dashboard')
assert.ok(clientBundle.includes('cb-show-hud'), 'client.js must include cb-show-hud')
assert.ok(clientBundle.includes('showToast'), 'client.js must include showToast')
assert.ok(clientBundle.includes('showConfirmModal'), 'client.js must include showConfirmModal')
assert.ok(clientBundle.includes('draggable="true"'), 'client.js must make sort items draggable')
assert.ok(clientBundle.includes('dragstart'), 'client.js must have dragstart listener')
assert.ok(clientBundle.includes('M8.5 1.5a.5.5'), 'client.js must include lightning bolt SVG icon')
assert.ok(clientBundle.includes('drawer-custom-name-input'), 'client.js must include custom name input in drawer')
assert.ok(clientBundle.includes('cb-hud-metric'), 'client.js must include HUD metrics selection checkboxes')
assert.ok(clientBundle.includes('btn-export-safe'), 'client.js must include btn-export-safe')
assert.ok(clientBundle.includes('btn-export-full'), 'client.js must include btn-export-full')
assert.ok(clientBundle.includes('btn-import-config'), 'client.js must include btn-import-config')
assert.ok(clientBundle.includes('siliconflow'), 'client.js must include siliconflow')
assert.ok(clientBundle.includes('openrouter'), 'client.js must include openrouter')
assert.ok(clientBundle.includes('M3.49 13.26'), 'client.js must include official IconGaugeOutline16')
assert.ok(!clientBundle.includes('dshQuotaPulse'), 'client.js must not include blurry dshQuotaPulse badge')
assert.ok(!clientBundle.includes('sort-list-header'), 'client.js must not include redundant sort-list-header')
assert.ok(!clientBundle.includes('btn-move-up'), 'client.js must not include explicit arrow move buttons')
assert.ok(!clientBundle.includes('⚡ 一键全部测活'), 'client.js must not include lightning emoji in 一键全部测活')
console.log('✓ client.js bundle verification passed')

// 10. Verify Safe Configuration Merging, Key Persistence, and Custom Names
const testKey1 = 'sk-test-deepseek-key-12345'
manager.saveConfig({
  deepseek: { apiKey: testKey1, enabled: true },
  customNames: { deepseek: 'My Custom DeepSeek' },
})
assert.equal(manager.getConfig().deepseek?.apiKey, testKey1, 'DeepSeek apiKey saved')
assert.equal(manager.getConfig().customNames?.deepseek, 'My Custom DeepSeek', 'DeepSeek custom name saved')

// Update a different provider and verify DeepSeek apiKey and customName are NOT lost
manager.saveConfig({
  claude: { apiKey: 'sk-ant-test-claude', enabled: true },
  customNames: { claude: 'Claude Opus' },
})
assert.equal(manager.getConfig().deepseek?.apiKey, testKey1, 'DeepSeek apiKey preserved after updating Claude')
assert.equal(manager.getConfig().customNames?.deepseek, 'My Custom DeepSeek', 'DeepSeek custom name preserved')
assert.equal(manager.getConfig().claude?.apiKey, 'sk-ant-test-claude', 'Claude apiKey saved')
assert.equal(manager.getConfig().customNames?.claude, 'Claude Opus', 'Claude custom name saved')

// Test delete / clear key
manager.saveConfig({
  deepseek: { apiKey: '', enabled: false },
})
assert.equal(manager.getConfig().deepseek?.apiKey, '', 'DeepSeek apiKey cleared')
assert.equal(manager.getConfig().claude?.apiKey, 'sk-ant-test-claude', 'Claude apiKey still preserved')

// Test clear custom name
manager.saveConfig({
  customNames: { claude: '' },
})
assert.equal(manager.getConfig().customNames?.claude, undefined, 'Claude custom name cleared')
assert.equal(manager.getConfig().customNames?.deepseek, 'My Custom DeepSeek', 'DeepSeek custom name still preserved')
console.log('✓ config merging, key persistence, and custom names passed')

// 11. Verify Usage Trend Points Calculation
const now = Date.now()
const dummyCards1 = [{
  id: 'usage_test',
  name: 'Usage Test',
  provider: 'deepseek',
  category: 'domestic_llm',
  status: 'ok',
  balance: { currency: 'CNY', total: 20, remaining: 15 },
  groups: [],
  lastUpdated: now - 3 * 86400000,
}]
const dummyCards2 = [{
  id: 'usage_test',
  name: 'Usage Test',
  provider: 'deepseek',
  category: 'domestic_llm',
  status: 'ok',
  balance: { currency: 'CNY', total: 20, remaining: 12 }, // 3 units consumed
  groups: [],
  lastUpdated: now,
}]
manager.historyManager.recordSnapshots(dummyCards1)
manager.historyManager.recordSnapshots(dummyCards2)

const usageTrend = manager.historyManager.getUsageTrendPoints('usage_test', 7)
assert.ok(Array.isArray(usageTrend), 'Usage trend returns array')
assert.equal(usageTrend.length, 7, 'Usage trend returns 7 bins')
assert.ok(usageTrend.some(p => p.r > 0), 'Usage trend should detect consumption peak')
assert.ok(!clientBundle.includes('余额充足'), 'client.js should not display 余额充足 badge')
assert.ok(!clientBundle.includes('额度充足') || clientBundle.includes('已用 0%'), 'client.js should avoid misleading status')
console.log('✓ usage trend calculation and balance UI verified')

// 12. Verify Detailed Settings modal & HUD metrics filtering
assert.ok(clientBundle.includes('dsh-details-modal'), 'client.js contains dsh-details-modal')
assert.ok(clientBundle.includes('dsh-details-modal-overlay'), 'client.js contains dsh-details-modal-overlay')
assert.ok(clientBundle.includes('cb-hud-metric'), 'client.js contains cb-hud-metric')
assert.ok(clientBundle.includes('Gemini 模型 · 周限额 (周用量)'), 'client.js contains Antigravity gemini weekly quota label')
assert.ok(clientBundle.includes('cardStartIndex'), 'client.js contains HUD fallback for unmatched cards')
assert.ok(clientBundle.includes('selWeekly'), 'client.js contains flexible weekly/5h Antigravity HUD matching')
console.log('✓ detailed settings modal and HUD metrics selection verified')

// 13. Verify Atomic JSON File Writing
const testAtomicFile = join(process.env.DSH_HOME, 'test-atomic.json')
atomicWriteJsonSync(testAtomicFile, { hello: 'world', timestamp: 123456 })
const atomicContent = JSON.parse(readFileSync(testAtomicFile, 'utf8'))
assert.equal(atomicContent.hello, 'world')
assert.equal(atomicContent.timestamp, 123456)
console.log('✓ atomicWriteJsonSync verified')

// 14. Verify Concurrency Limiter
let activeCount = 0
let maxConcurrent = 0
const dummyTasks = Array.from({ length: 15 }, (_, i) => i)
const concurrentRes = await runWithConcurrency(dummyTasks, async (val) => {
  activeCount++
  maxConcurrent = Math.max(maxConcurrent, activeCount)
  await new Promise(r => setTimeout(r, 10))
  activeCount--
  return val * 2
}, 5)
assert.equal(concurrentRes.length, 15)
assert.ok(maxConcurrent <= 5, `Max concurrent should not exceed 5, was ${maxConcurrent}`)
assert.equal(concurrentRes[0].value, 0)
assert.equal(concurrentRes[14].value, 28)
console.log('✓ runWithConcurrency bounded at limit=5 passed')

// 15. Verify fetchWithProxy (proxy fallback & error decoration)
const testServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, source: 'direct-server' }))
})

await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve))
const testPort = testServer.address().port
const testServerUrl = `http://127.0.0.1:${testPort}/ping`

try {
  // Test A: Direct fetch without proxy
  const resDirect = await fetchWithProxy(testServerUrl, {}, undefined, 5000)
  assert.equal(resDirect.status, 200)
  const jsonDirect = await resDirect.json()
  assert.equal(jsonDirect.ok, true)

  // Test B: Dead proxy fallback to direct fetch
  const deadProxyUrl = 'http://127.0.0.1:59999'
  const resFallback = await fetchWithProxy(testServerUrl, {}, deadProxyUrl, 5000)
  assert.equal(resFallback.status, 200)
  const jsonFallback = await resFallback.json()
  assert.equal(jsonFallback.ok, true)

  // Test C: Dead proxy with unreachable target yields informative dual error
  let dualErrorCaught = false
  try {
    await fetchWithProxy('http://127.0.0.1:59998/unreachable', {}, deadProxyUrl, 2000)
  } catch (err) {
    dualErrorCaught = true
    assert.match(err.message, /fetch failed: proxy \(/)
    assert.match(err.message, /& direct \(/)
  }
  assert.ok(dualErrorCaught, 'Should catch dual proxy & direct failure error')

  // Test D: Direct fetch error decoration includes error code
  let directErrorCaught = false
  try {
    await fetchWithProxy('http://127.0.0.1:59998/unreachable', {}, undefined, 2000)
  } catch (err) {
    directErrorCaught = true
    assert.match(err.message, /fetch failed \(/)
  }
  assert.ok(directErrorCaught, 'Should catch decorated direct failure error')

  console.log('✓ fetchWithProxy proxy fallback & error decoration verified')
} finally {
  await new Promise((resolve) => testServer.close(resolve))
}

console.log('🎉 All dsh-quota v0.3.1 tests passed successfully!')
