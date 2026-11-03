#!/usr/bin/env node
/**
 * Read-only Antigravity quota probe.
 *
 * Prints the group/bucket structure the upstream actually returns, so a plan or
 * protocol change can be confirmed against a real account instead of a fixture.
 * Secrets are never printed; the account e-mail is masked.
 *
 * Usage: node scripts/probe-antigravity.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}

const config = readJson(join(dshHome, 'quota-config.json')) || {}
const secrets = readJson(join(dshHome, 'quota-secrets.json'))?.secrets
const agySecrets = secrets?.providers?.antigravity
if (agySecrets) config.antigravity = { ...(config.antigravity || {}), ...agySecrets }

const { AntigravityProvider } = await import('../lib/index.js')
const provider = new AntigravityProvider()

const test = await provider.testConnection(config)
console.log('testConnection:', test.ok ? 'OK' : 'FAILED', '-', test.message)

const { card } = await provider.fetchCard(config)
const maskEmail = (value) => value ? value.replace(/^(.).*(@.*)$/, '$1***$2') : undefined

console.log('\n--- card ---')
console.log('status   :', card.status)
console.log('plan     :', card.plan ?? '(upstream returned no plan field)')
console.log('account  :', maskEmail(card.account) ?? '(unknown)')
console.log('groups   :', card.groups.length)
console.log('source   :', card.sourceProvenance?.method, card.sourceProvenance?.host ?? '')
if (card.error) console.log('error    :', card.error)

for (const group of card.groups) {
  console.log(`\n[group] ${group.title}  poolType=${group.poolType ?? '-'}`)
  for (const win of group.windows) {
    console.log(`   - ${win.label}`)
    console.log(`     id=${win.id} bucketId=${win.bucketId ?? '-'} kind=${win.windowKind ?? '-'} status=${win.status ?? '-'}`)
    console.log(`     remaining=${win.remainingPercent}% resetAt=${win.resetAt ?? '-'}`)
  }
}

const hasArgon = card.groups.some(g => g.poolType === 'argon' || /argon/i.test(g.title))
console.log('\n--- verdict ---')
console.log('Argon pool present:', hasArgon ? 'YES (three-group layout)' : 'NO (two-group layout or Argon merged upstream)')
