/**
 * DeepSeek time-of-day tariff for the quota cards.
 *
 * DeepSeek's published price list halves every token price outside its high
 * demand windows. Those windows are defined in Beijing time (UTC+8, no daylight
 * saving) on Monday through Friday, excluding Chinese statutory holidays:
 * 09:00–12:00 and 14:00–18:00. Everything else, including weekends, is
 * off-peak. Statutory holidays cannot be derived from a clock, so a weekday
 * holiday still reads as peak here.
 */

/** Beijing-time hours `[start, end)` that bill at the peak rate. */
export const PEAK_WINDOWS: ReadonlyArray<readonly [number, number]> = [[9, 12], [14, 18]]

/** Beijing time never observes daylight saving, so one fixed offset is exact. */
const BEIJING_OFFSET_MS = 8 * 3_600_000

/**
 * Whether one instant falls inside a DeepSeek peak window.
 * @param now - current epoch milliseconds.
 * @returns true only inside a weekday peak window, ignoring Chinese holidays.
 */
export function isPeakTime(now: number): boolean {
  if (!Number.isFinite(now)) return false
  const beijing = new Date(now + BEIJING_OFFSET_MS)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = beijing.getUTCHours()
  return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end)
}

/**
 * Format the current Beijing wall clock as `HH:mm`.
 * @param now - current epoch milliseconds.
 * @returns the zero-padded Beijing time, so a reader can check the badge.
 */
export function beijingClock(now: number): string {
  if (!Number.isFinite(now)) return '—'
  const beijing = new Date(now + BEIJING_OFFSET_MS)
  const hour = String(beijing.getUTCHours()).padStart(2, '0')
  const minute = String(beijing.getUTCMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}
