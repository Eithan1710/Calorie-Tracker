import { useEffect, useState } from 'react'
import { Sheet, PrimaryButton, GhostButton } from '../primitives'
import { decideLegacy, importLegacyData, legacyDataSummary, useStore, type LegacySummary } from '../../data/store'
import { showToast } from '../toast'

/**
 * One-time question after the first login on a device that was used before
 * accounts existed: attach the data stored on this device to this account?
 * Nothing is moved silently, so a friend logging in on your phone never gets
 * your history.
 */
export function LegacyImportSheet() {
  const userId = useStore((s) => s.userId)
  const ready = useStore((s) => s.ready)
  const [summary, setSummary] = useState<LegacySummary | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId || !ready) return
    let alive = true
    void legacyDataSummary().then((s) => alive && setSummary(s))
    return () => {
      alive = false
    }
  }, [userId, ready])

  if (!summary) return null
  const parts = [
    summary.food ? `${summary.food} רישומי אוכל` : '',
    summary.exercise ? `${summary.exercise} אימונים` : '',
    summary.days ? `צעדים מ-${summary.days} ימים` : '',
    summary.hasProfile ? 'פרופיל' : '',
  ].filter(Boolean)

  const close = () => {
    decideLegacy()
    setSummary(null)
  }

  return (
    <Sheet
      open
      onClose={close}
      title="נמצאו נתונים במכשיר"
      footer={
        <div className="flex gap-2">
          <PrimaryButton
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const n = await importLegacyData()
              setBusy(false)
              setSummary(null)
              showToast(n ? 'הנתונים צורפו לחשבון שלך' : 'הפרופיל צורף לחשבון שלך')
            }}
          >
            כן, אלה הנתונים שלי
          </PrimaryButton>
          <GhostButton onClick={close} disabled={busy}>
            לא
          </GhostButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3 pt-1 pb-2 text-[15px] leading-relaxed text-ink-2">
        <p>
          במכשיר הזה שמורים נתונים מלפני שהיו חשבונות: <b className="text-ink">{parts.join(' · ')}</b>.
        </p>
        <p>לצרף אותם לחשבון שלך? הם יסונכרנו לחשבון ויופיעו בכל מכשיר שתתחבר ממנו. אם הם של מישהו אחר — בחר ״לא״.</p>
      </div>
    </Sheet>
  )
}
