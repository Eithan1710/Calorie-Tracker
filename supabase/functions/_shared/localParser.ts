import { FOODS, FOOD_BY_KEY, type FoodRef, type UnitKey } from './foodDb.ts'
import type { Analysis, FoodItem } from './schema.ts'
import { newId, overallConfidence, per100FromRef, scale, totalsOf } from './nutrition.ts'

/**
 * Deterministic Hebrew food parser.
 *
 * Handles the common, simple phrasing ("3 ביצים, 2 פרוסות לחם, קוטג' וסלט",
 * "150 גרם פסטה בולונז") with no network at all. Used:
 *   - on the client when offline (so logging never blocks), and
 *   - on the server as the last fallback when every AI provider failed.
 *
 * It never guesses foods it doesn't know: unknown segments are returned in
 * `unmatched` and the caller decides (queue for AI / ask the user).
 */

export interface LocalParseResult {
  analysis: Analysis | null
  unmatched: string[]
}

export function normalizeHebrew(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, '') // niqqud & cantillation
    .replace(/[׳`´‘’]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const NUMBER_WORDS: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שנים: 2, שתיים: 2, שתים: 2, זוג: 2,
  שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7,
  שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, חצי: 0.5, רבע: 0.25,
}

/**
 * unit word → [unit key | 'g' | 'ml' | 'kg'].
 * Unit words are deliberately NOT part of food aliases ("פרוסות לחם" would
 * otherwise out-rank "לחם מלא" in "2 פרוסות לחם מלא").
 */
const UNIT_WORDS: Record<string, UnitKey | 'g' | 'kg' | 'ml' | 'l'> = {
  גרם: 'g', "ג'": 'g', "גר'": 'g', גר: 'g', ג: 'g', gr: 'g', g: 'g',
  קילו: 'kg', 'ק"ג': 'kg', kg: 'kg',
  'מ"ל': 'ml', מל: 'ml', ml: 'ml', ליטר: 'l',
  יחידה: 'unit', יחידות: 'unit',
  פרוסה: 'slice', פרוסות: 'slice', פרוסת: 'slice', משולש: 'slice', משולשים: 'slice',
  כף: 'tbsp', כפות: 'tbsp',
  כפית: 'tsp', כפיות: 'tsp',
  כוס: 'cup', כוסות: 'cup', ספל: 'cup',
  חופן: 'handful', חופנים: 'handful', חופנית: 'handful',
  מנה: 'serving', מנות: 'serving', צלחת: 'serving', קערה: 'serving', קערת: 'serving',
  קופסה: 'can', קופסת: 'can', קופסא: 'can', קופסאות: 'can', פחית: 'can', פחיות: 'can',
  גביע: 'container', גביעים: 'container', גביע_של: 'container',
  סקופ: 'scoop', סקופים: 'scoop', מצקת: 'scoop',
  שקית: 'bag', שקיות: 'bag',
  כדור: 'unit', כדורי: 'unit', כדורים: 'unit', קלח: 'unit', טבלה: 'unit', טבלת: 'unit',
  חתיכה: 'piece', חתיכות: 'piece', קובייה: 'piece', קוביות: 'piece', קוביה: 'piece',
}

const SIZE_WORDS: Record<string, number> = { גדול: 1.3, גדולה: 1.3, גדולים: 1.3, גדולות: 1.3, קטן: 0.7, קטנה: 0.7, קטנים: 0.7, קטנות: 0.7 }

const LEAD_PHRASES = [
  'אכלתי', 'שתיתי', 'היה לי', 'לארוחת בוקר', 'לארוחת צהריים', 'לארוחת ערב', 'ארוחת בוקר', 'ארוחת צהריים',
  'ארוחת ערב', 'בבוקר', 'בצהריים', 'בערב', 'נשנשתי', 'גם', 'עוד', 'בערך', 'משהו כמו', 'כ-', 'כ',
]
const STOP_WORDS = new Set(['של', 'עם', 'בלי', 'ללא', 'קצת', 'בערך', 'גם', 'עוד', 'כ', 'ה', 'ו', 'מ', 'את', 'עם', 'בתוך', 'על', 'היום'])
const PREFIXES = ['וה', 'ו', 'ה', 'ב', 'ש', 'מ', 'ל', 'כ']

interface AliasEntry { tokens: string[]; ref: FoodRef }
const ALIASES: AliasEntry[] = FOODS.flatMap((ref) =>
  [...new Set([ref.he, ...ref.aliases])].map((a) => ({ tokens: normalizeHebrew(a).split(' '), ref })),
).sort((a, b) => b.tokens.join(' ').length - a.tokens.join(' ').length)

function stripPrefix(tok: string, candidates: Set<string>): string {
  if (candidates.has(tok)) return tok
  for (const p of PREFIXES) {
    if (tok.startsWith(p) && tok.length > p.length + 1 && candidates.has(tok.slice(p.length))) return tok.slice(p.length)
  }
  return tok
}

const ALIAS_FIRST_TOKENS = new Set(ALIASES.map((a) => a.tokens[0]))
const KNOWN_LEADS = new Set([...ALIAS_FIRST_TOKENS, ...Object.keys(NUMBER_WORDS), ...Object.keys(UNIT_WORDS)])

/** Split the free text into food segments. */
function segment(text: string): { text: string; afterWith: boolean }[] {
  let t = normalizeHebrew(text)
  t = t.replace(/(^|\s)כ-?(?=\d)/g, '$1').replace(/(\d+)\s*-\s*(\d+)/g, (_m, a, b) => String((Number(a) + Number(b)) / 2))
  for (const lead of LEAD_PHRASES) {
    t = t.replace(new RegExp(`(^|[\\s,])${lead}(?=\\s)`, 'g'), '$1')
  }
  const out: { text: string; afterWith: boolean }[] = []
  for (const chunk of t.split(/[,،;\n]+|\.(?!\d)|\s\+\s/)) {
    const tokens = chunk.trim().split(' ').filter(Boolean)
    let cur: string[] = []
    let afterWith = false
    const flush = (nextAfterWith: boolean) => {
      if (cur.length) out.push({ text: cur.join(' '), afterWith })
      cur = []
      afterWith = nextAfterWith
    }
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok === 'עם' || tok === 'וגם' || tok === 'ועוד' || tok === 'ו') {
        flush(tok === 'עם')
        continue
      }
      // "וסלט", "ו2" → new segment if what follows the ו is something we know
      if (cur.length && tok.startsWith('ו') && tok.length > 1) {
        const rest = tok.slice(1)
        const restNoHe = rest.startsWith('ה') ? rest.slice(1) : rest
        if (/^\d/.test(rest) || KNOWN_LEADS.has(rest) || KNOWN_LEADS.has(restNoHe)) {
          // "כוס וחצי" — keep the half with the current segment
          if (rest === 'חצי' && cur.length) { cur.push('וחצי'); continue }
          flush(false)
          cur.push(KNOWN_LEADS.has(rest) || /^\d/.test(rest) ? rest : restNoHe)
          continue
        }
      }
      cur.push(tok)
    }
    flush(false)
  }
  return out.filter((s) => s.text.length > 0)
}

function parseNumber(tok: string): number | null {
  if (/^\d+([.,]\d+)?$/.test(tok)) return parseFloat(tok.replace(',', '.'))
  if (/^\d+\/\d+$/.test(tok)) {
    const [a, b] = tok.split('/').map(Number)
    return b ? a / b : null
  }
  return NUMBER_WORDS[tok] ?? null
}

interface SegmentParse { ref: FoodRef; grams: number; confidence: number; assumptions: string[] }

function matchFood(tokens: string[]): { ref: FoodRef; start: number; len: number } | null {
  const candidates = new Set(ALIASES.flatMap((a) => a.tokens))
  const toks = tokens.map((t) => stripPrefix(t, candidates))
  for (const alias of ALIASES) {
    const n = alias.tokens.length
    for (let i = 0; i + n <= toks.length; i++) {
      let ok = true
      for (let j = 0; j < n; j++) if (toks[i + j] !== alias.tokens[j]) { ok = false; break }
      if (ok) return { ref: alias.ref, start: i, len: n }
    }
  }
  return null
}

function parseSegment(seg: string): SegmentParse | null {
  // separate glued numbers/units: "200גרם", "2כפות"
  const tokens = seg.replace(/(\d)([א-ת])/g, '$1 $2').split(' ').filter(Boolean)
  const match = matchFood(tokens)
  if (!match) return null
  const { ref } = match

  let count: number | null = null
  let unit: (typeof UNIT_WORDS)[string] | null = null
  let sizeFactor = 1
  const leftovers: string[] = []

  tokens.forEach((raw, idx) => {
    if (idx >= match.start && idx < match.start + match.len) return
    const tok = raw.replace(/^ו(?=חצי)/, '')
    const n = parseNumber(tok)
    if (n !== null) {
      if (tok === 'חצי' && (count !== null || raw !== tok)) count = (count ?? 1) + 0.5
      else if (count === null) count = n
      else count *= n
      return
    }
    const u = UNIT_WORDS[tok] ?? UNIT_WORDS[tok.replace(/^ה/, '')]
    if (u) { unit = u; return }
    if (SIZE_WORDS[tok]) { sizeFactor = SIZE_WORDS[tok]; return }
    if (!STOP_WORDS.has(tok) && !/^\d+%$/.test(tok)) leftovers.push(tok)
  })

  const assumptions: string[] = []
  let grams: number
  let confidence: number
  const u = unit as (typeof UNIT_WORDS)[string] | null
  if (u === 'g' || u === 'ml') {
    grams = count ?? ref.units.serving
    confidence = 0.85
  } else if (u === 'kg' || u === 'l') {
    grams = (count ?? 1) * 1000
    confidence = 0.85
  } else if (u) {
    const per = ref.units[u] ?? ref.units.unit ?? ref.units.serving
    grams = (count ?? 1) * per * sizeFactor
    confidence = ref.units[u] ? 0.75 : 0.55
    assumptions.push(`${count ?? 1} × ${Math.round(per)} גרם`)
  } else if (count !== null) {
    const per = ref.units.unit ?? ref.units.serving
    grams = count * per * sizeFactor
    confidence = ref.units.unit ? 0.75 : 0.55
    assumptions.push(`${count} × ${Math.round(per)} גרם ליחידה`)
  } else {
    grams = ref.units.serving * sizeFactor
    confidence = 0.5
    assumptions.push(`מנה סטנדרטית ~${Math.round(grams)} גרם`)
  }
  if (sizeFactor !== 1) assumptions.push(sizeFactor > 1 ? 'מנה גדולה מהרגיל' : 'מנה קטנה מהרגיל')
  if (ref.state === 'raw' && ref.key === 'ground_beef_raw') assumptions.push('משקל נא, כמקובל בתפריטים')
  if (leftovers.length) confidence -= 0.15

  return { ref, grams: Math.round(grams), confidence: Math.max(0.3, confidence), assumptions }
}

export function parseLocally(text: string): LocalParseResult {
  const segs = segment(text)
  const items: FoodItem[] = []
  const unmatched: string[] = []

  for (const seg of segs) {
    const parsed = parseSegment(seg.text)
    if (!parsed) {
      unmatched.push(seg.text)
      continue
    }
    // "טוסט עם גבינה צהובה" — the cheese is already in the toast
    const prev = items[items.length - 1]
    const prevRef = prev?.db_key ? FOOD_BY_KEY[prev.db_key] : undefined
    if (seg.afterWith && prevRef?.includes?.includes(parsed.ref.key)) continue

    const per100 = per100FromRef(parsed.ref)
    items.push({
      id: newId(),
      name: parsed.ref.he,
      grams: parsed.grams,
      per100,
      ...scale(per100, parsed.grams),
      confidence: Math.round(parsed.confidence * 100) / 100,
      assumptions: parsed.assumptions,
      source: 'db',
      db_key: parsed.ref.key,
      state: parsed.ref.state,
      emoji: parsed.ref.emoji,
    })
  }

  if (!items.length) return { analysis: null, unmatched }

  const title = items.length === 1 ? items[0].name : items.slice(0, 3).map((i) => i.name.replace(/\s*\(.*\)/, '')).join(', ')
  const analysis: Analysis = {
    title,
    emoji: items[0].emoji ?? '🍽️',
    items,
    totals: totalsOf(items),
    overall_confidence: overallConfidence(items),
    clarification: null,
    provider: 'local',
  }
  return { analysis, unmatched }
}
