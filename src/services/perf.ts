/**
 * Lightweight timing for the two things that matter: how fast the app is usable
 * after launch, and how long a food photo takes from picking it to the result.
 * Numbers only — never image data, tokens or food text. Kept on this device
 * (last 20 photo flows + last 10 launches) and shown in Settings → "מהירות".
 */

const KEY = 'maazan:perf'
const MAX_FLOWS = 20
const MAX_LAUNCHES = 10

export interface PhotoFlow {
  at: string
  /** original photo size (MB) */
  photo_mb: number
  /** bytes sent to the server (KB) */
  sent_kb: number
  /** decode + resize + JPEG encode on the phone */
  prepare_ms: number
  /** request sent → response received (upload + server + AI + download) */
  request_ms: number
  /** server-side stages from the Server-Timing header, when present */
  server?: Record<string, number>
  /** response → result on screen */
  render_ms: number
  total_ms: number
  ok: boolean
}

export interface Launch {
  at: string
  /** navigation start → upload button usable */
  ready_ms: number
  /** navigation start → main script started */
  script_ms: number
}

interface Stored {
  flows: PhotoFlow[]
  launches: Launch[]
}

function load(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Stored
    return { flows: Array.isArray(s.flows) ? s.flows : [], launches: Array.isArray(s.launches) ? s.launches : [] }
  } catch {
    return { flows: [], launches: [] }
  }
}
function store(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

export function getPerf(): Stored {
  return load()
}

/** main.tsx: the app script started */
export const scriptStart = typeof performance !== 'undefined' ? performance.now() : 0
let launchRecorded = false

/** The camera / add buttons are on screen and usable. Recorded once per launch. */
export function markReady() {
  if (launchRecorded || typeof performance === 'undefined') return
  launchRecorded = true
  const ready = performance.now()
  try {
    performance.mark('mz:ready')
  } catch {
    /* ignore */
  }
  const s = load()
  s.launches = [...s.launches, { at: new Date().toISOString(), ready_ms: Math.round(ready), script_ms: Math.round(scriptStart) }].slice(-MAX_LAUNCHES)
  store(s)
}

/** One photo → result flow. Call the steps in order; `finish` stores it. */
export function startPhotoFlow(photoBytes: number) {
  const t0 = performance.now()
  const f: Partial<PhotoFlow> & { t?: Record<string, number> } = { photo_mb: Math.round((photoBytes / 1e6) * 10) / 10, t: { start: t0 } }
  return {
    prepared() {
      f.t!.prepared = performance.now()
    },
    sent(bytes: number) {
      f.t!.sent = performance.now()
      f.sent_kb = Math.round(bytes / 1024)
    },
    received(serverTiming: string | null) {
      f.t!.received = performance.now()
      if (serverTiming) f.server = parseServerTiming(serverTiming)
    },
    finish(ok: boolean) {
      const t = f.t!
      const end = performance.now()
      const flow: PhotoFlow = {
        at: new Date().toISOString(),
        photo_mb: f.photo_mb ?? 0,
        sent_kb: f.sent_kb ?? 0,
        prepare_ms: Math.round((t.prepared ?? t.start) - t.start),
        request_ms: Math.round((t.received ?? end) - (t.sent ?? t.prepared ?? t.start)),
        server: f.server,
        render_ms: Math.round(end - (t.received ?? end)),
        total_ms: Math.round(end - t.start),
        ok,
      }
      const s = load()
      s.flows = [...s.flows, flow].slice(-MAX_FLOWS)
      store(s)
      return flow
    },
  }
}
export type PhotoFlowTimer = ReturnType<typeof startPhotoFlow>

/** "auth;dur=120, ai;dur=4100" → { auth: 120, ai: 4100 } */
export function parseServerTiming(h: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of h.split(',')) {
    const [name, ...params] = part.trim().split(';')
    const dur = params.map((p) => p.trim()).find((p) => p.startsWith('dur='))
    if (name && dur) out[name] = Math.round(Number(dur.slice(4)))
  }
  return out
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
