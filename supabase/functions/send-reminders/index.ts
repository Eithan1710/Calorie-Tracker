// Supabase Edge Function: send-reminders
//  POST  (from pg_cron every 15 min, header x-cron-secret) → sends due reminders.
//        At most ONE Web Push per subscription per local day, at/after reminder_time,
//        skipping users who already logged something this evening (after 17:00 local).
//  GET   ?vapid-public-key → the Web Push public key the browser subscribes with.
//        The key pair is generated on first use and kept in Vault (private key never leaves Supabase).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { corsHeaders, json, safeEqual } from '../_shared/http.ts'
import { getSecret, setSecret } from '../_shared/secrets.ts'

const WINDOW_MIN = 60 // a cron hiccup won't skip the day, but we never send hours late

function localParts(tz: string, now: Date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

async function vapidKeys(admin: SupabaseClient): Promise<{ publicKey: string; privateKey: string } | null> {
  const publicKey = await getSecret(admin, 'VAPID_PUBLIC_KEY', 'mz_vapid_public')
  const privateKey = await getSecret(admin, 'VAPID_PRIVATE_KEY', 'mz_vapid_private')
  if (publicKey && privateKey) return { publicKey, privateKey }
  const fresh = webpush.generateVAPIDKeys()
  const ok = (await setSecret(admin, 'mz_vapid_private', fresh.privateKey)) && (await setSecret(admin, 'mz_vapid_public', fresh.publicKey))
  return ok ? fresh : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    if (!new URL(req.url).searchParams.has('vapid-public-key')) return json({ error: 'not found' }, 404)
    const keys = await vapidKeys(admin)
    return keys ? json({ publicKey: keys.publicKey }) : json({ error: 'unavailable' }, 503)
  }

  const secret = (await getSecret(admin, 'CRON_SECRET', 'mz_cron_secret')) ?? ''
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json({ error: 'forbidden' }, 403)

  const keys = await vapidKeys(admin)
  if (!keys) return json({ error: 'no vapid keys' }, 500)
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:reminders@maazan.app', keys.publicKey, keys.privateKey)

  const { data: subs, error } = await admin.from('mz_push_subscriptions').select('*').eq('enabled', true)
  if (error) return json({ error: error.message }, 500)

  const now = new Date()
  let sent = 0
  let skipped = 0
  for (const s of subs ?? []) {
    const { date, minutes } = localParts(s.timezone, now)
    const [h, m] = String(s.reminder_time).split(':').map(Number)
    const due = h * 60 + m
    if (s.last_sent_on === date || minutes < due || minutes > due + WINDOW_MIN) continue

    // already logged tonight? (entries created after 17:00 local today)
    const { data: recent } = await admin
      .from('mz_food_entries')
      .select('created_at')
      .eq('user_id', s.user_id)
      .eq('date', date)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const last = recent?.[0]?.created_at ? localParts(s.timezone, new Date(recent[0].created_at)) : null
    await admin.from('mz_push_subscriptions').update({ last_sent_on: date }).eq('id', s.id)
    if (last && last.date === date && last.minutes >= 17 * 60) {
      skipped++
      continue
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: 'מאזן', body: 'לא שכחת לעדכן את היום? 🥗', url: './?add=1' }),
        { TTL: 60 * 60 * 3, urgency: 'normal' },
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await admin.from('mz_push_subscriptions').update({ enabled: false }).eq('id', s.id)
    }
  }
  return json({ ok: true, sent, skipped })
})
