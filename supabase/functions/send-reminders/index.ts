// Supabase Edge Function: invoked by pg_cron every 15 min (see migrations/…_reminder_cron.sql).
// Sends at most ONE Web Push per subscription per local day, at/after reminder_time,
// and skips users who already logged something this evening (after 17:00 local).
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { json, safeEqual } from '../_shared/http.ts'

const WINDOW_MIN = 60 // a cron hiccup won't skip the day, but we never send hours late

function localParts(tz: string, now: Date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json({ error: 'forbidden' }, 403)

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: subs, error } = await admin.from('push_subscriptions').select('*').eq('enabled', true)
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
      .from('food_entries')
      .select('created_at')
      .eq('user_id', s.user_id)
      .eq('date', date)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const last = recent?.[0]?.created_at ? localParts(s.timezone, new Date(recent[0].created_at)) : null
    await admin.from('push_subscriptions').update({ last_sent_on: date }).eq('id', s.id)
    if (last && last.date === date && last.minutes >= 17 * 60) {
      skipped++
      continue
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: 'מאזן', body: 'לא שכחת לעדכן את היום? 🥗', url: '/?add=1' }),
        { TTL: 60 * 60 * 3, urgency: 'normal' },
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await admin.from('push_subscriptions').update({ enabled: false }).eq('id', s.id)
    }
  }
  return json({ ok: true, sent, skipped })
})
