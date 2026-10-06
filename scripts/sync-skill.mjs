// Embeds skills/nutrition-analysis/SKILL.md into the edge-function bundle as a
// TS string (Supabase Edge Functions can't read arbitrary repo files at runtime).
// Runs automatically before dev/build/test; a unit test fails if it's stale.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(root, 'skills/nutrition-analysis/SKILL.md'), 'utf8')
const body = md.replace(/^---[\s\S]*?---\s*/, '')
const out = `// AUTO-GENERATED from skills/nutrition-analysis/SKILL.md by scripts/sync-skill.mjs — do not edit.\nexport const NUTRITION_SKILL = ${JSON.stringify(body)}\n`
const target = join(root, 'supabase/functions/_shared/skill.generated.ts')
let prev = ''
try { prev = readFileSync(target, 'utf8') } catch { /* first run */ }
if (prev !== out) {
  writeFileSync(target, out)
  console.log('nutrition skill synced →', target)
}
