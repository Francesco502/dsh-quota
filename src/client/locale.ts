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
}

/**
 * Register the namespace and return a bound translator. Never throws: a host
 * without the locale service (or with an incompatible shape) keeps English.
 */
export function registerQuotaLocale(ctx: any): QuotaTranslate {
  const locale: LocaleService | undefined = serviceOf(ctx, 'locale')
  if (locale === undefined) return fallback

  try {
    locale.register?.(LOCALE_NS, DICT)
  } catch (error) {
    console.warn('[dsh-quota] locale registration failed:', (error as Error)?.message ?? error)
    return fallback
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
    try {
      return bound!(key, params)
    } catch {
      return fallback(key, params)
    }
  }
}
