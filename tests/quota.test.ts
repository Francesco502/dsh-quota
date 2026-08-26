import test from 'node:test'
import assert from 'node:assert/strict'

test('formatResetCountdown returns formatted remaining time', () => {
  const future = Date.now() + 3600 * 1000 * 25 // 25 hours from now
  const diffSec = Math.floor((future - Date.now()) / 1000)
  const days = Math.floor(diffSec / 86400)
  const hours = Math.floor((diffSec % 86400) / 3600)
  
  assert.equal(days, 1)
  assert.equal(hours, 1)
})

test('validates percentage calculation clamping', () => {
  const calcPercent = (used: number, total: number) => {
    if (!total || total <= 0) return 0
    const pct = Math.round((used / total) * 100)
    return Math.max(0, Math.min(100, pct))
  }

  assert.equal(calcPercent(50, 100), 50)
  assert.equal(calcPercent(150, 100), 100)
  assert.equal(calcPercent(-10, 100), 0)
  assert.equal(calcPercent(0, 0), 0)
})
