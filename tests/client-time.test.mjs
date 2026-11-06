import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSpan, formatStamp, sinceUpdate, untilReset } from '../lib/client-time.js'

test('stamps are DD-MM-YYYY HH:mm:ss with no 12-hour marker', () => {
  const value = new Date(2026, 10, 10, 0, 3, 10)
  assert.equal(formatStamp(value), '10-11-2026 00:03:10')
  assert.equal(formatStamp(new Date(2026, 0, 5, 23, 59, 59)), '05-01-2026 23:59:59')
  assert.equal(formatStamp(new Date(2026, 5, 1, 13, 7, 4)), '01-06-2026 13:07:04')
  assert.doesNotMatch(formatStamp(value), /AM|PM/)
})

test('invalid stamps degrade to an em dash', () => {
  assert.equal(formatStamp('not a date'), '—')
  assert.equal(formatStamp(undefined), '—')
  assert.equal(formatStamp(''), '—')
})

test('spans use the two largest units', () => {
  const hour = 3_600_000
  assert.equal(formatSpan(46 * hour), '1d 22h')
  assert.equal(formatSpan(3 * hour + 10 * 60_000), '3h 10m')
  assert.equal(formatSpan(4 * 60_000 + 5_000), '4m 5s')
  assert.equal(formatSpan(12_000), '12s')
  assert.equal(formatSpan(0), '0s')
  assert.equal(formatSpan(1), '0s')
})

test('reset time counts down and stops at zero', () => {
  const now = Date.parse('2026-11-06T00:50:41Z')
  assert.equal(untilReset(now + 46 * 3_600_000, now), '1d 22h')
  assert.equal(untilReset(now - 5_000, now), '0s')
  assert.equal(untilReset(now, now), '0s')
  assert.equal(untilReset(undefined, now), '—')
})

test('update age uses one unit', () => {
  const now = Date.parse('2026-11-06T00:50:41Z')
  assert.equal(sinceUpdate(now - 4 * 60_000, now), '4m')
  assert.equal(sinceUpdate(now - 2 * 3_600_000, now), '2h')
  assert.equal(sinceUpdate(now - 30_000, now), '30s')
  assert.equal(sinceUpdate(now + 60_000, now), '0s')
  assert.equal(sinceUpdate('nope', now), '0s')
})
