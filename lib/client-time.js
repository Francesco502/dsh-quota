/**
 * Date and duration rendering for the quota panel.
 *
 * One fixed, locale-independent layout: `DD-MM-YYYY HH:mm:ss` in the browser's
 * zone with a 24-hour clock, so a timestamp never depends on the host locale's
 * 12-hour preference. Durations are compact English units, matching the panel's
 * `Resets` and `Updated` labels in every language.
 */

/** Two-digit zero padding. */
const pad = (value        )         => String(value).padStart(2, '0')

/**
 * Format one instant as `DD-MM-YYYY HH:mm:ss` in local time.
 * @param value - epoch milliseconds, ISO text, or a Date.
 * @returns the stamp, or an em dash for an unusable value.
 */
export function formatStamp(value                                           )         {
  if (value === null || value === undefined || value === '') return '—'
  const at = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(at.getTime())) return '—'
  return `${pad(at.getDate())}-${pad(at.getMonth() + 1)}-${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * Format a non-negative interval using its largest units.
 * @param milliseconds - interval length; a negative value is treated as its magnitude.
 * @param units - how many units to show, 1 or 2 (default 2).
 * @returns compact text such as `1d 22h`, `3h 10m`, `4m 5s`, or `0s`.
 */
export function formatSpan(milliseconds        , units        = 2)         {
  const seconds = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(Math.abs(milliseconds) / 1000)) : 0
  const parts                          = [
    [Math.floor(seconds / 86_400), 'd'],
    [Math.floor(seconds % 86_400 / 3_600), 'h'],
    [Math.floor(seconds % 3_600 / 60), 'm'],
    [seconds % 60, 's'],
  ]
  const first = parts.findIndex(([value]) => value > 0)
  const start = first < 0 ? parts.length - 1 : first
  return parts.slice(start, start + units).map(([value, unit]) => `${value}${unit}`).join(' ')
}

/**
 * Remaining time before a reset: the future interval, or `now` once it passed.
 * @param resetsAt - reset instant, epoch ms or ISO text.
 * @param now - current epoch milliseconds.
 * @returns compact text such as `1d 22h`.
 */
export function untilReset(resetsAt                                    , now        )         {
  if (resetsAt === null || resetsAt === undefined || resetsAt === '') return '—'
  const at = new Date(resetsAt).getTime()
  if (!Number.isFinite(at)) return '—'
  const remaining = at - now
  return remaining <= 0 ? '0s' : formatSpan(remaining, 2)
}

/**
 * How long ago something happened, in one unit: `4m`, `2h`, `1d`.
 * @param updatedAt - past instant, epoch ms or ISO text.
 * @param now - current epoch milliseconds.
 * @returns compact text such as `4m`; `0s` for a future or invalid value.
 */
export function sinceUpdate(updatedAt                                    , now        )         {
  if (updatedAt === null || updatedAt === undefined || updatedAt === '') return '0s'
  const at = new Date(updatedAt).getTime()
  if (!Number.isFinite(at)) return '0s'
  const elapsed = now - at
  return elapsed <= 0 ? '0s' : formatSpan(elapsed, 1)
}
