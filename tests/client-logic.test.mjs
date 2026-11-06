/**
 * Client-track pure-logic regression tests (no DOM).
 *
 * Node 26 strips TypeScript natively, so the client modules are imported
 * directly. Only module-level pure functions are exercised here; rendering
 * requires a DOM and is verified in the browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveApiBase,
  resolveApiUrl,
  escapeHtmlText,
  escapeCardText,
  isQuantified,
  windowQuotaKind,
  makeHudMetricKey,
} from '../src/client/api.ts'
import { formatWindowSubtitle, formatClockTime } from '../src/client/view.ts'
import { alarmNotificationKey, formatErrorForUi } from '../src/client/controller.ts'

test('resolveApiBase prefers the desktop transport base', () => {
  const base = resolveApiBase({
    global: { __DSH_TRANSPORT__: { streamBaseUrl: 'https://desktop.local/transport/' } },
    baseURI: 'https://web.local/app/',
  })
  assert.equal(base, 'https://desktop.local/transport/')
})

test('resolveApiBase falls back to document.baseURI', () => {
  assert.equal(resolveApiBase({ global: {}, baseURI: 'https://web.local/app/' }), 'https://web.local/app/')
  // An empty/blank transport base must not shadow the document base.
  assert.equal(
    resolveApiBase({ global: { __DSH_TRANSPORT__: { streamBaseUrl: '   ' } }, baseURI: 'https://web.local/app/' }),
    'https://web.local/app/',
  )
})

test('resolveApiBase returns "/" when nothing is available', () => {
  assert.equal(resolveApiBase({ global: undefined, baseURI: undefined }), '/')
})

test('resolveApiUrl keeps every request relative to the resolved base', () => {
  assert.equal(
    resolveApiUrl('api/dsh-quota/status', { baseURI: 'https://web.local/app/' }),
    'https://web.local/app/api/dsh-quota/status',
  )
  // Leading slashes are stripped so the path stays under the base prefix.
  assert.equal(
    resolveApiUrl('/api/dsh-quota/config', { global: { __DSH_TRANSPORT__: { streamBaseUrl: 'https://desk.local/base/' } } }),
    'https://desk.local/base/api/dsh-quota/config',
  )
  // A base without a trailing slash gains one before resolution.
  assert.equal(
    resolveApiUrl('api/dsh-quota/status', { baseURI: 'https://web.local/app' }),
    'https://web.local/app/api/dsh-quota/status',
  )
  // No absolute base at all: stay origin-relative.
  assert.equal(resolveApiUrl('api/dsh-quota/status', { global: undefined, baseURI: undefined }), '/api/dsh-quota/status')
})

test('escapeHtmlText escapes markup and handles missing values', () => {
  assert.equal(escapeHtmlText('<img src=x onerror="a&\'b">'), '&lt;img src=x onerror=&quot;a&amp;&#39;b&quot;&gt;')
  assert.equal(escapeHtmlText(undefined), '')
  assert.equal(escapeHtmlText(null), '')
  assert.equal(escapeHtmlText(0), '0')
})

test('escapeCardText escapes every remote string, including amountText', () => {
  const card = {
    id: 'deepseek_default',
    name: '<b>DeepSeek</b>',
    provider: 'deepseek',
    category: 'domestic_llm',
    status: 'ok',
    plan: '<i>pro</i>',
    account: 'a@b.c"><script>',
    error: '<svg onload=alert(1)>',
    groups: [{
      title: '<em>Balance</em>',
      windows: [{
        id: 'balance',
        label: '<script>x</script>',
        subtitle: '"sub"',
        amountText: '<img src=x>',
      }],
    }],
    lastUpdated: 1,
  }
  const escaped = escapeCardText(card)
  assert.equal(escaped.name, '&lt;b&gt;DeepSeek&lt;/b&gt;')
  assert.equal(escaped.plan, '&lt;i&gt;pro&lt;/i&gt;')
  assert.equal(escaped.account, 'a@b.c&quot;&gt;&lt;script&gt;')
  assert.equal(escaped.error, '&lt;svg onload=alert(1)&gt;')
  assert.equal(escaped.groups[0].title, '&lt;em&gt;Balance&lt;/em&gt;')
  assert.equal(escaped.groups[0].windows[0].label, '&lt;script&gt;x&lt;/script&gt;')
  assert.equal(escaped.groups[0].windows[0].subtitle, '&quot;sub&quot;')
  assert.equal(escaped.groups[0].windows[0].amountText, '&lt;img src=x&gt;')
  // The input object is not mutated.
  assert.equal(card.name, '<b>DeepSeek</b>')
})

test('windowQuotaKind resolves legacy windows by percentage presence', () => {
  assert.equal(windowQuotaKind({ id: 'a', label: 'a', remainingPercent: 10, usedPercent: 90 }), 'usage')
  assert.equal(windowQuotaKind({ id: 'a', label: 'a' }), 'unknown')
  assert.equal(windowQuotaKind({ id: 'a', label: 'a', quotaKind: 'balance', remainingPercent: 100 }), 'balance')
  assert.equal(windowQuotaKind({ id: 'a', label: 'a', quotaKind: 'liveness' }), 'liveness')
})

test('isQuantified only accepts usage windows with two finite percentages', () => {
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'usage', usedPercent: 10, remainingPercent: 90 }), true)
  // Legacy usage window (no quotaKind) with both numbers is quantified.
  assert.equal(isQuantified({ id: 'a', label: 'a', usedPercent: 10, remainingPercent: 90 }), true)

  // Boundaries: missing, NaN and Infinity are never quantified.
  assert.equal(isQuantified({ id: 'a', label: 'a' }), false)
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'usage', usedPercent: 10, remainingPercent: NaN }), false)
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'usage', usedPercent: 10, remainingPercent: Infinity }), false)
  // Only one side present: malformed, not quantified.
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'usage', remainingPercent: 90 }), false)
  assert.equal(isQuantified({ id: 'a', label: 'a', remainingPercent: 90 }), false)

  // A provider that wrongly left percentages on a non-usage window must be ignored.
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'liveness', usedPercent: 0, remainingPercent: 100 }), false)
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'balance', usedPercent: 0, remainingPercent: 100 }), false)
  assert.equal(isQuantified({ id: 'a', label: 'a', quotaKind: 'unknown', usedPercent: 50, remainingPercent: 50 }), false)
})

test('formatWindowSubtitle: usage keeps the real ratio sentence', () => {
  assert.equal(
    formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'usage', usedPercent: 0, remainingPercent: 100 }),
    '已用 0% · 额度充足',
  )
  assert.equal(
    formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'usage', usedPercent: 58, remainingPercent: 42 }),
    '已用 58%',
  )
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const subtitle = formatWindowSubtitle(
    {
      id: 'w',
      label: 'w',
      quotaKind: 'usage',
      usedPercent: 58,
      remainingPercent: 42,
      resetAt: new Date(now + 2 * 3600 * 1000).toISOString(),
    },
    now,
  )
  assert.match(subtitle, /^已用 58% · 预计 2 小时后重置/)
})

test('formatWindowSubtitle: balance shows the amount, never a percentage', () => {
  const withAmount = formatWindowSubtitle({
    id: 'w',
    label: 'w',
    quotaKind: 'balance',
    amountText: '¥12.34',
    usedPercent: 0,
    remainingPercent: 100,
  })
  assert.equal(withAmount, '余额 ¥12.34')

  // Missing amount is an em-dash; a full percentage must not leak in.
  assert.equal(formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'balance' }), '—')
  assert.equal(
    formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'balance', usedPercent: 0, remainingPercent: 100 }),
    '—',
  )
  // An explicit upstream subtitle wins.
  assert.equal(
    formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'balance', subtitle: '充值余额', amountText: '¥1' }),
    '充值余额',
  )
})

test('formatWindowSubtitle: liveness says connectivity only', () => {
  const subtitle = formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'liveness' })
  assert.match(subtitle, /仅连通性|未提供额度接口/)
  assert.doesNotMatch(subtitle, /额度和充足|额度充足/)
  // Even a provider bug that leaves 100% on a liveness window must not produce "额度充足".
  const withPercent = formatWindowSubtitle({
    id: 'w',
    label: 'w',
    quotaKind: 'liveness',
    usedPercent: 0,
    remainingPercent: 100,
  })
  assert.doesNotMatch(withPercent, /额度充足/)
  assert.doesNotMatch(withPercent, /已用/)
})

test('formatWindowSubtitle: unknown stays unknown (never 0%)', () => {
  assert.equal(formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'unknown' }), '额度状态未知')
  // Legacy window without a ratio resolves to unknown.
  assert.equal(formatWindowSubtitle({ id: 'w', label: 'w' }), '额度状态未知')
  // Malformed usage (one percentage missing) must not be rendered as 0%.
  const malformed = formatWindowSubtitle({ id: 'w', label: 'w', quotaKind: 'usage', remainingPercent: 42 })
  assert.equal(malformed, '额度状态未知')
  assert.doesNotMatch(malformed, /0%|42%/)
})

test('formatClockTime renders hh:mm and rejects unknown timestamps', () => {
  const stamp = new Date(2026, 0, 2, 9, 5, 0).getTime()
  assert.equal(formatClockTime(stamp), '09:05')
  assert.equal(formatClockTime(0), '')
  assert.equal(formatClockTime(NaN), '')
})

test('alarmNotificationKey is stable per instance/level/window', () => {
  assert.equal(
    alarmNotificationKey({ instanceId: 'deepseek_default', level: 'critical', windowId: '5h' }),
    'deepseek_default_critical_5h',
  )
  // Message changes (e.g. remaining 12.3% -> 11.9%) must not create a new key.
  assert.equal(
    alarmNotificationKey({ instanceId: 'deepseek_default', level: 'critical', windowId: '5h' }),
    alarmNotificationKey({ instanceId: 'deepseek_default', level: 'critical', windowId: '5h' }),
  )
  // Level is part of the key so warn -> critical notifies again.
  assert.notEqual(
    alarmNotificationKey({ instanceId: 'x', level: 'warn', windowId: 'w' }),
    alarmNotificationKey({ instanceId: 'x', level: 'critical', windowId: 'w' }),
  )
  // Window-less alarms remain addressable.
  assert.equal(alarmNotificationKey({ instanceId: 'x', level: 'warn' }), 'x_warn_')
})

test('HUD metric keys remain distinct for same-named groups', () => {
  assert.equal(makeHudMetricKey('deepseek', 'Balance', 'deepseek'), 'deepseek::Balance::deepseek')
  assert.equal(makeHudMetricKey('custom_api', 'a::b', 'w'), 'custom_api::a%3A%3Ab::w')
})

test('formatErrorForUi always yields readable text', () => {
  assert.equal(formatErrorForUi(new Error('额度接口请求超时（8 秒未响应）')), '额度接口请求超时（8 秒未响应）')
  assert.equal(formatErrorForUi('boom'), 'boom')
  assert.equal(formatErrorForUi(undefined), '未知错误')
  assert.equal(formatErrorForUi({}), '未知错误')
})
