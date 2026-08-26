import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Universal fetch with proxy support and timeout
 */
export async function fetchWithProxy(
  url: string,
  init: RequestInit & { dispatcher?: any } = {},
  proxyUrl?: string,
  timeoutMs = 20000
): Promise<Response> {
  const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  
  let signal = init.signal
  if (!signal && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    signal = (AbortSignal as any).timeout(timeoutMs)
  }

  if (!proxy) {
    return fetch(url, { ...init, signal })
  }

  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const requireFromProfile = createRequire(join(dshHome, 'profiles', 'web', 'package.json'))
    const { ProxyAgent } = requireFromProfile('undici')
    const dispatcher = new ProxyAgent(proxy)
    return fetch(url, { ...init, signal, dispatcher } as any)
  } catch {
    // If ProxyAgent fails to load, fallback to standard fetch
    return fetch(url, { ...init, signal })
  }
}
