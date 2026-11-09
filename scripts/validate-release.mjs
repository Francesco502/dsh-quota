#!/usr/bin/env node
/**
 * Release gate for @francescoli/dsh-quota (cross-platform, no PowerShell needed).
 *
 * Usage: npm run validate:release -- --tag v0.4.4
 *        GITHUB_REF_NAME=v0.4.4 node scripts/validate-release.mjs   (CI)
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

const argv = process.argv.slice(2)
const tagFlagIndex = argv.indexOf('--tag')
const inlineTag = argv.find((arg) => arg.startsWith('--tag='))
const tag =
  (inlineTag ? inlineTag.slice('--tag='.length) : undefined) ??
  (tagFlagIndex >= 0 ? argv[tagFlagIndex + 1] : undefined) ??
  process.env.GITHUB_REF_NAME ??
  process.env.npm_config_tag

if (!tag) {
  console.error('validate-release: provide --tag vX.Y.Z or GITHUB_REF_NAME')
  process.exit(2)
}

const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
check(match !== null, `tag "${tag}" must match vMAJOR.MINOR.PATCH`)
const version = match ? `${match[1]}.${match[2]}.${match[3]}` : ''

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check(pkg.name === '@francescoli/dsh-quota', `package name must be @francescoli/dsh-quota, got ${pkg.name}`)
check(pkg.version === version, `package.json version ${pkg.version} !== tag ${version}`)
check(pkg.publishConfig?.access === 'public', 'publishConfig.access must be "public"')
check(pkg.publishConfig?.registry === 'https://registry.npmjs.org/', 'publishConfig.registry must be the public npm registry')
check(typeof pkg.engines?.dsh === 'string', 'engines.dsh must declare the compatible DSH range')
check(Array.isArray(pkg.files) && pkg.files.includes('lib'), 'files must include lib')

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
check(/^## \[Unreleased\]\s*$/m.test(changelog), 'CHANGELOG.md must keep an [Unreleased] section')
const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, 'm')
check(heading.test(changelog), `CHANGELOG.md must contain "## [${version}] - YYYY-MM-DD"`)

for (const file of ['lib/index.js', 'lib/client.js', 'lib/index.js.map', 'lib/client.js.map']) {
  const full = join(root, file)
  check(existsSync(full), `${file} is missing (run npm run build)`)
  if (existsSync(full)) check(statSync(full).size > 0, `${file} is empty`)
}

const clientPath = join(root, 'lib/client.js')
if (existsSync(clientPath)) {
  const client = readFileSync(clientPath, 'utf8')
  check(client.trimStart().startsWith('(function () {'), 'lib/client.js must start with the IIFE wrapper')
  check((client.match(/__ModuleLoader__\.load\(/g) ?? []).length === 1, 'lib/client.js must register exactly one module id')
  check(client.includes('id: "@francescoli/dsh-quota"'), 'lib/client.js must register "@francescoli/dsh-quota"')
  check(client.includes('sourceMappingURL=client.js.map'), 'lib/client.js must reference its source map')
  check(!/^\s*export\s/m.test(client), 'lib/client.js must not contain ESM export statements')
}

const readme = readFileSync(join(root, 'README.md'), 'utf8')
check(readme.includes(`v${version}`), `README.md must mention v${version}`)

if (failures.length > 0) {
  console.error('validate-release failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log(`validate-release passed for ${tag}`)
