import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beijingClock, isPeakTime } from '../lib/client-peak-hours.js'

// 2026-11-06 is a Friday; 2026-11-07 is a Saturday. Beijing is UTC+8, so
// 01:00Z is 09:00 Beijing and 10:00Z is 18:00 Beijing.
const utc = text => Date.parse(text)

test('weekday peak windows are 09:00-12:00 and 14:00-18:00 Beijing time', () => {
  assert.equal(isPeakTime(utc('2026-11-06T01:00:00Z')), true, 'Friday 09:00')
  assert.equal(isPeakTime(utc('2026-11-06T03:59:00Z')), true, 'Friday 11:59')
  assert.equal(isPeakTime(utc('2026-11-06T04:00:00Z')), false, 'Friday 12:00')
  assert.equal(isPeakTime(utc('2026-11-06T05:59:00Z')), false, 'Friday 13:59')
  assert.equal(isPeakTime(utc('2026-11-06T06:00:00Z')), true, 'Friday 14:00')
  assert.equal(isPeakTime(utc('2026-11-06T09:59:00Z')), true, 'Friday 17:59')
  assert.equal(isPeakTime(utc('2026-11-06T10:00:00Z')), false, 'Friday 18:00')
})

test('the whole weekend is off-peak', () => {
  assert.equal(isPeakTime(utc('2026-11-07T01:00:00Z')), false, 'Saturday 09:00')
  assert.equal(isPeakTime(utc('2026-11-07T06:00:00Z')), false, 'Saturday 14:00')
  assert.equal(isPeakTime(utc('2026-11-08T06:00:00Z')), false, 'Sunday 14:00')
})

test('outside the windows the rate is off-peak', () => {
  assert.equal(isPeakTime(utc('2026-11-06T00:00:00Z')), false, 'Friday 08:00')
  assert.equal(isPeakTime(utc('2026-11-05T20:00:00Z')), false, 'Friday 04:00')
  assert.equal(isPeakTime(utc('2026-11-06T12:00:00Z')), false, 'Friday 20:00')
})

test('the Beijing clock is zero-padded 24-hour time', () => {
  assert.equal(beijingClock(utc('2026-11-06T10:47:00Z')), '18:47')
  assert.equal(beijingClock(utc('2026-11-06T16:05:00Z')), '00:05')
  assert.equal(beijingClock(Number.NaN), '—')
  assert.equal(isPeakTime(Number.NaN), false)
})
