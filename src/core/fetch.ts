import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

let cachedUndici: any = null

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

function extractErrorCode(err: any): string {
  if (!err) return 'UNKNOWN'
  return err.cause?.code || err.code || err.cause?.message || err.message || 'UNKNOWN'
}

/**
 * Universal fetch with proxy support, timeout, and robust direct fallback.
 */
export async function fetchWithProxy(
  url: string,
  init: RequestInit & { dispatcher?: any } = {},
  proxyUrl?: string,
  timeoutMs = 20000
): Promise<Response> {
  const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  const explicitSignal = init.signal

  // If no proxy configured, perform direct fetch with error decoration
  if (!proxy) {
    const signal = explicitSignal || makeTimeoutSignal(timeoutMs)
    try {
      const { dispatcher: _ignored, ...directInit } = init as any
      return await fetch(url, { ...directInit, signal })
    } catch (err: any) {
      const code = extractErrorCode(err)
      throw new Error(`fetch failed (${code}): ${err.message}`)
    }
  }

  // Attempt proxy fetch using undici.fetch + ProxyAgent
  let proxyErr: any = null
  const undici = getUndici()
  if (undici && undici.ProxyAgent && typeof undici.fetch === 'function') {
    try {
      const dispatcher = new undici.ProxyAgent(proxy)
      const signal = explicitSignal || makeTimeoutSignal(timeoutMs)
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

  // Fallback to direct fetch if proxy failed or was unavailable
  try {
    const { dispatcher: _ignored, ...directInit } = init as any
    const directSignal = explicitSignal || makeTimeoutSignal(timeoutMs)
    return await fetch(url, { ...directInit, signal: directSignal })
  } catch (directErr: any) {
    const directCode = extractErrorCode(directErr)
    const proxyCode = extractErrorCode(proxyErr)
    throw new Error(`fetch failed: proxy (${proxyCode} @ ${proxy}) & direct (${directCode})`)
  }
}
