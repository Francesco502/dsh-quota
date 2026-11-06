/**
 * Read an optional host service without declaring a hard dependency.
 *
 * A Cordis client context throws when a plugin reads an undeclared service
 * ("cannot get property \"layout\" without inject"). This plugin must keep
 * working on hosts that have no slots/layout/locale, so it probes through
 * `ctx.get(name)` — the resolver path — and only falls back to property access
 * for hosts that expose the service directly.
 */
export function serviceOf(ctx: any, name: string): any {
  if (ctx === null || ctx === undefined) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch {
    /* undeclared or unavailable: treat as absent */
  }
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}
