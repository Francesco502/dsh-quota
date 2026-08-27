import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseDir = fileURLToPath(new URL('.', import.meta.url))
const files = [
  'src/core/types.ts',
  'src/core/paths.ts',
  'src/core/fetch.ts',
  'src/core/oauth.ts',
  'src/core/history.ts',
  'src/core/alarm.ts',
  'src/providers/deepseek.ts',
  'src/providers/cursor.ts',
  'src/providers/codex.ts',
  'src/providers/antigravity.ts',
  'src/providers/copilot.ts',
  'src/providers/openai-billing.ts',
  'src/providers/claude.ts',
  'src/providers/kimi.ts',
  'src/providers/glm.ts',
  'src/providers/minimax.ts',
  'src/providers/qwen.ts',
  'src/providers/volcengine.ts',
  'src/providers/opencode-go.ts',
  'src/providers/custom-api.ts',
  'src/core/manager.ts',
  'src/routes.ts',
  'src/index.ts',
]

let combined = ''
for (const file of files) {
  let content = readFileSync(join(baseDir, file), 'utf8')
  content = content.replace(/import\s+type\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
  content = content.replace(/import\s+http\s+from\s+['"]node:http['"];?/g, '')
  content = content.replace(/import\s+net\s+from\s+['"]node:net['"];?/g, '')
  content = content.replace(/import\s+\{\s*randomBytes,\s*createHash\s*\}\s+from\s+['"]node:crypto['"];?/g, '')
  content = content.replace(/import\s+\{\s*(existsSync|readFileSync|writeFileSync|mkdirSync|statSync)\s*(?:,\s*(existsSync|readFileSync|writeFileSync|mkdirSync|statSync)\s*)*\}\s+from\s+['"]node:fs['"];?/g, '')
  content = content.replace(/import\s+\{\s*(join)\s*\}\s+from\s+['"]node:path['"];?/g, '')
  content = content.replace(/import\s+\{\s*createRequire\s*\}\s+from\s+['"]node:module['"];?/g, '')
  content = content.replace(/import\s+\{\s*(homedir|platform)\s*(?:,\s*(homedir|platform)\s*)*\}\s+from\s+['"]node:os['"];?/g, '')
  content = content.replace(/import\s+\{\s*DatabaseSync\s*\}\s+from\s+['"]node:sqlite['"];?/g, '')
  content = content.replace(/import\s+[^;]+from\s+['"]\.\/[^'"]+['"];?/g, '')
  content = content.replace(/import\s+[^;]+from\s+['"]\.\.\/[^'"]+['"];?/g, '')
  content = content.replace(/export\s+(class|function|const|let|var|type|interface)\s+/g, '$1 ')
  combined += '\n' + content
}

const clean = stripTypeScriptTypes(combined)
const header = `import http from 'node:http'\nimport net from 'node:net'\nimport { randomBytes, createHash } from 'node:crypto'\nimport { createRequire } from 'node:module'\nimport { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { homedir, platform } from 'node:os'\n`
const footer = `\nexport { inject, apply, VERSION, PLUGIN_VERSION, QuotaManager, DeepSeekProvider, CursorProvider, CodexProvider, AntigravityProvider, GitHubCopilotProvider, OpenAIBillingProvider, ClaudeProvider, KimiProvider, GLMProvider, MiniMaxProvider, QwenProvider, VolcengineProvider, OpenCodeGoProvider, CustomApiProvider, formatQuotaResetText, getRefreshIntervalSeconds }\n`

mkdirSync(join(baseDir, 'lib'), { recursive: true })
writeFileSync(join(baseDir, 'lib/index.js'), header + clean + footer, 'utf8')
console.log('Successfully built host bundle lib/index.js')
