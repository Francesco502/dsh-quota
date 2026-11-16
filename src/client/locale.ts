/**
 * Locale wiring for the plugin's shell surfaces.
 *
 * The host requires both baseline dictionaries (`zh` and `en`). Only the strings
 * that appear in shell chrome are translated here; the dashboard body keeps its
 * existing copy until the full string extraction lands.
 */
import { serviceOf } from './services.ts'

export const LOCALE_NS = 'dsh-quota'

const DICT = {
  zh: {
    entry: '额度监控',
    panel: '额度监控',
    'footer.open': '额度监控',
    'badge.alarms': '有额度告警',
    'badge.alarmsCount': '有 {count} 条额度告警',
  },
  en: {
    entry: 'Quota Monitor',
    panel: 'Quota Monitor',
    'footer.open': 'Quota Monitor',
    'badge.alarms': 'Quota alerts',
    'badge.alarmsCount': '{count} quota alerts',
  },
} as const

export type QuotaTranslate = (key: keyof (typeof DICT)['zh'], params?: Record<string, string | number>) => string

const fallback: QuotaTranslate = (key, params) => {
  const template = DICT.en[key] ?? String(key)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

type LocaleService = {
  register?: (ns: string, dict: Record<string, Record<string, string>>) => unknown
  bind?: (ns: string) => (key: string, params?: Record<string, string | number>) => string
  /** LocaleFace snapshot: `active` is the locale the host is rendering. */
  getSnapshot?: () => { active?: string } | undefined
}

/** Fill `{name}` placeholders in a template. */
function applyParams(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** The active host locale, when the service exposes it. */
function activeLocaleOf(locale: LocaleService): string | undefined {
  try {
    const snapshot = locale.getSnapshot?.()
    return typeof snapshot?.active === 'string' ? snapshot.active : undefined
  } catch {
    return undefined
  }
}

/**
 * Register the namespace and return a bound translator. Never throws: a host
 * without the locale service (or with an incompatible shape) keeps English.
 *
 * Two host behaviours used to strand the Chinese dictionary and surface
 * `Quota Monitor` in a Chinese shell:
 *  - a reload can find the namespace's locale entries already registered and
 *    reject the duplicate, which must not be treated as "no translations";
 *  - `bind` falls back to English per key, so a zh shell reading a key the host
 *    did not resolve must use this plugin's own zh dictionary, not English.
 */
export function registerQuotaLocale(ctx: any): QuotaTranslate {
  const locale: LocaleService | undefined = serviceOf(ctx, 'locale')
  if (locale === undefined) return fallback

  try {
    locale.register?.(LOCALE_NS, DICT)
  } catch (error) {
    // The dictionaries are already installed by an earlier instance of this
    // plugin; binding below still resolves through them.
    console.warn('[dsh-quota] locale dictionaries already present:', (error as Error)?.message ?? error)
  }

  if (typeof locale.bind !== 'function') return fallback
  let bound: ((key: string, params?: Record<string, string | number>) => string) | undefined
  try {
    bound = locale.bind(LOCALE_NS)
  } catch {
    return fallback
  }
  if (typeof bound !== 'function') return fallback

  return (key, params) => {
    const template = DICT.zh[key]
    const english = DICT.en[key]
    if (activeLocaleOf(locale) === 'zh' && template !== undefined) {
      return applyParams(template, params)
    }
    try {
      const text = bound!(key, params)
      if (text !== key) return text
    } catch {
      /* fall through to the local dictionary */
    }
    return applyParams(english ?? template ?? String(key), params)
  }
}
