import assert from 'node:assert/strict'

console.log('Running quota and format tests...')

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

// 2. Format reset countdown
const formatCountdown = (ms) => {
  if (ms <= 0) return '即将重置'
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
}

assert.equal(formatCountdown(86400000 * 2 + 3600000 * 3), '2天 3小时')
assert.equal(formatCountdown(3600000 * 5 + 60000 * 20), '5小时 20分钟')
assert.equal(formatCountdown(60000 * 15), '15分钟')
assert.equal(formatCountdown(0), '即将重置')
console.log('✓ formatCountdown passed')

console.log('All tests passed successfully!')
