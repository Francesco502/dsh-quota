import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProxyMode } from './types.ts'

let cachedUndici: any = null
const proxyAgentCache = new Map<string, any>()

function getUndici(): any {
  if (cachedUndici) return cachedUndici
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidates = [
    join(dshHome, 'profiles', 'web', 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'web', 'package.json'),
  ]
  for (const c of candidates) {
    try {
      const req = createRequire(c)
      const u = req('undici')
      if (u && (u.ProxyAgent || u.fetch)) {
        cachedUndici = u
        return u
      }
    } catch {}
  }
  return null
}

function makeTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return (AbortSignal as any).timeout(timeoutMs)
  }
  return undefined
}

function combineSignals(timeoutMs: number, explicitSignal?: AbortSignal): AbortSignal {
  const timeoutSig = makeTimeoutSignal(timeoutMs)
  if (!explicitSignal) {
    return timeoutSig || new AbortController().signal
  }
  if (!timeoutSig) return explicitSignal

  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any([explicitSignal, timeoutSig])
  }

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  explicitSignal.addEventListener('abort', onAbort, { once: true })
  timeoutSig.addEventListener('abort', onAbort, { once: true })
  if (explicitSignal.aborted || timeoutSig.aborted) ctrl.abort()
  return ctrl.signal
}

function extractErrorCode(err: any): string {
  if (!err) return 'UNKNOWN'
  return err.cause?.code || err.code || err.cause?.message || err.message || 'UNKNOWN'
}

/**
 * Strips sensitive username/password from proxy URLs before logging or error messages.
 */
export function sanitizeProxyUrl(rawUrl?: string): string {
  if (!rawUrl) return ''
  try {
    const u = new URL(rawUrl)
    if (u.username || u.password) {
      u.username = '***'
      u.password = '***'
    }
    return u.toString()
  } catch {
    return rawUrl.replace(/\/\/[^@]+@/, '//***:***@')
  }
}

/**
 * Universal fetch with proxy support, timeout, combined signal cancellation,
 * proxy fail-closed security, and error sanitization.
 */
export async function fetchWithProxy(
  url: string,
  init: RequestInit & { dispatcher?: any } = {},
  proxyUrl?: string,
  timeoutMs = 20000,
  proxyMode: ProxyMode = 'proxy-preferred'
): Promise<Response> {
  if (proxyMode === 'direct') {
    proxyUrl = undefined
  }

  const proxy = proxyUrl || (proxyMode !== 'direct' ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) : undefined)
  const explicitSignal = init.signal
  const safeProxyStr = sanitizeProxyUrl(proxy)

  // 1. Direct fetch if no proxy is configured or mode is 'direct'
  if (!proxy) {
    const signal = combineSignals(timeoutMs, explicitSignal)
    try {
      const { dispatcher: _ignored, ...directInit } = init as any
      return await fetch(url, { ...directInit, signal })
    } catch (err: any) {
      const code = extractErrorCode(err)
      throw new Error(`fetch failed (${code}): ${err.message}`)
    }
  }

  // 2. Attempt proxy fetch using undici.fetch + cached ProxyAgent
  let proxyErr: any = null
  const undici = getUndici()
  if (undici && undici.ProxyAgent && typeof undici.fetch === 'function') {
    try {
      let dispatcher = proxyAgentCache.get(proxy)
      if (!dispatcher) {
        dispatcher = new undici.ProxyAgent(proxy)
        proxyAgentCache.set(proxy, dispatcher)
      }
      const signal = combineSignals(timeoutMs, explicitSignal)
      return await undici.fetch(url, { ...init, signal, dispatcher })
    } catch (err: any) {
      proxyErr = err
    }
  } else {
    proxyErr = new Error('undici ProxyAgent unavailable')
  }

  // If explicit signal was already aborted, do not fallback
  if (explicitSignal?.aborted) {
    throw proxyErr || new Error('Request aborted')
  }

  // 3. If proxyMode is 'proxy-required', fail-closed immediately without falling back to direct
  if (proxyMode === 'proxy-required') {
    const proxyCode = extractErrorCode(proxyErr)
    throw new Error(`proxy connection required but failed (${proxyCode} @ ${safeProxyStr}): ${proxyErr?.message || 'proxy unreachable'}`)
  }

  // 4. Fallback to direct fetch in 'proxy-preferred' mode
  try {
    const { dispatcher: _ignored, ...directInit } = init as any
    const directSignal = combineSignals(timeoutMs, explicitSignal)
    return await fetch(url, { ...directInit, signal: directSignal })
  } catch (directErr: any) {
    const directCode = extractErrorCode(directErr)
    const proxyCode = extractErrorCode(proxyErr)
    throw new Error(`fetch failed: proxy (${proxyCode} @ ${safeProxyStr}) & direct (${directCode})`)
  }
}
