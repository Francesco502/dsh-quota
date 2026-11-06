/**
 * Remote-URL guard for user-supplied endpoints (custom OneAPI/NewAPI relays,
 * OpenAI-compatible base URLs).
 *
 * Threat model: the plugin API is reachable from the local machine, so a request
 * body could name any host. The route guard rejects cross-site callers, and this
 * module is the second line of defence: no non-HTTP schemes, no cloud-metadata /
 * link-local targets, and no hostname whose DNS answer lands on one.
 *
 * Private ranges are deliberately allowed: a relay on 127.0.0.1, 192.168.x or a
 * corporate 10.x network is a legitimate deployment for this feature.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.home.arpa']

const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
])

export interface RemoteUrlOptions {
  /** Allow hostnames that resolve to 127.0.0.0/8 and ::1 (default true: local relays are legitimate). */
  allowLoopback?: boolean
}

export class UnsafeRemoteUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeRemoteUrlError'
  }
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** IPv4 link-local (169.254.0.0/16) and the cloud metadata endpoints that live there. */
function isLinkLocalV4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  return parts[0] === 169 && parts[1] === 254
}

function isLoopbackV4(address: string): boolean {
  return address.startsWith('127.')
}

function isLoopbackV6(address: string): boolean {
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
}

function isLinkLocalV6(address: string): boolean {
  const normalized = address.toLowerCase()
  // fe80::/10
  return /^fe[89ab][0-9a-f]:/.test(normalized) || normalized === 'fd00:ec2::254'
}

/** Unspecified/multicast addresses are never a valid relay target. */
function isNeverUsable(address: string): boolean {
  return address === '0.0.0.0' || address === '::' || address === '[::]'
}

async function assertAddressAllowed(address: string, options: RemoteUrlOptions): Promise<void> {
  const clean = stripBrackets(address)
  if (isNeverUsable(clean)) throw new UnsafeRemoteUrlError(`拒绝不可用的地址: ${clean}`)
  if (isLinkLocalV4(clean) || isLinkLocalV6(clean)) {
    throw new UnsafeRemoteUrlError(`拒绝链路本地/云元数据地址: ${clean}`)
  }
  const allowLoopback = options.allowLoopback !== false
  if (!allowLoopback && (isLoopbackV4(clean) || isLoopbackV6(clean))) {
    throw new UnsafeRemoteUrlError(`拒绝回环地址: ${clean}`)
  }
}

/**
 * Validate a user-supplied base URL. Throws UnsafeRemoteUrlError when the target
 * is not an http(s) endpoint or resolves into a blocked range.
 */
export async function assertSafeRemoteUrl(raw: string, options: RemoteUrlOptions = {}): Promise<URL> {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) throw new UnsafeRemoteUrlError('地址为空')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new UnsafeRemoteUrlError(`地址格式无效: ${trimmed}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeRemoteUrlError(`只支持 http/https: ${url.protocol}`)
  }
  if (url.username || url.password) {
    // Credentials belong in the secrets file, not inside a URL that gets logged.
    throw new UnsafeRemoteUrlError('地址中不得内嵌用户名/密码')
  }

  const hostname = stripBrackets(url.hostname).toLowerCase()
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeRemoteUrlError(`拒绝该主机: ${hostname}`)
  }

  if (isIP(hostname)) {
    await assertAddressAllowed(hostname, options)
    return url
  }

  // Hostname: resolve once and reject answers that land on metadata/link-local.
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch (error: any) {
    throw new UnsafeRemoteUrlError(`无法解析主机 ${hostname}: ${error?.message ?? error}`)
  }
  if (addresses.length === 0) throw new UnsafeRemoteUrlError(`无法解析主机 ${hostname}`)

  for (const entry of addresses) {
    const address = entry.address
    if (isNeverUsable(address)) throw new UnsafeRemoteUrlError(`拒绝不可用的地址: ${address}`)
    if (isLinkLocalV4(address) || isLinkLocalV6(address)) {
      throw new UnsafeRemoteUrlError(`主机 ${hostname} 解析到链路本地/云元数据地址 ${address}`)
    }
  }

  return url
}

/** Safe variant for call sites that prefer a boolean over an exception. */
export async function isSafeRemoteUrl(raw: string, options: RemoteUrlOptions = {}): Promise<boolean> {
  try {
    await assertSafeRemoteUrl(raw, options)
    return true
  } catch {
    return false
  }
}
