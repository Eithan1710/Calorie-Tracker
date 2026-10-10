import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, EllipsisVertical, Share, SquarePlus, X } from 'lucide-react'
import { Sheet, PrimaryButton } from './primitives'
import { bannerDismissed, dismissBanner, promptInstall, useInstall, type Platform } from '../services/install'
import { showToast } from './toast'

/**
 * "התקן את האפליקציה" — three quiet entry points:
 *  • banner: a slim, dismissible strip on the home screen (phones, or wherever the browser can install)
 *  • row:    a permanent entry in Settings (until the app is installed)
 *  • link:   a small link under the login form
 * Taps open the browser's own install dialog when available, otherwise short instructions.
 */
export function InstallApp({ variant }: { variant: 'banner' | 'row' | 'link' }) {
  const { installedHere, canPrompt, platform } = useInstall()
  const [helpOpen, setHelpOpen] = useState(false)
  const [hidden, setHidden] = useState(() => variant === 'banner' && bannerDismissed())

  if (installedHere || hidden) return null
  // the banner/link only where installing is a real option: the browser offers it, or a phone
  if (variant !== 'row' && !canPrompt && platform === 'desktop') return null

  const install = async () => {
    if (canPrompt) {
      const r = await promptInstall()
      if (r === 'accepted') showToast('האפליקציה הותקנה — אפשר לפתוח אותה ממסך הבית')
      if (r !== 'unavailable') return
    }
    setHelpOpen(true)
  }

  const help = <InstallHelp open={helpOpen} onClose={() => setHelpOpen(false)} platform={platform} />

  if (variant === 'link') {
    return (
      <>
        <button type="button" onClick={() => void install()} className="pressable mx-auto flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink-2">
          <Download className="size-4" aria-hidden /> התקן את האפליקציה
        </button>
        {help}
      </>
    )
  }

  if (variant === 'row') {
    return (
      <section className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <img src={`${import.meta.env.BASE_URL}pwa-192.png`} alt="" className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">אפליקציה במסך הבית</p>
          <p className="text-sm text-ink-3">נפתחת בחלון משלה, בלי שורת כתובת</p>
        </div>
        <button type="button" onClick={() => void install()} className="pressable min-h-11 shrink-0 rounded-xl bg-ink px-4 text-sm font-semibold text-inverse">
          התקן את האפליקציה
        </button>
        {help}
      </section>
    )
  }

  return (
    <div className="animate-rise mb-3 flex items-center gap-2 rounded-2xl border border-line bg-surface py-1.5 ps-3 pe-1.5" role="region" aria-label="התקנת האפליקציה">
      <img src={`${import.meta.env.BASE_URL}pwa-192.png`} alt="" className="size-8 shrink-0 rounded-lg" />
      <p className="min-w-0 flex-1 truncate text-[15px] text-ink-2">פתיחה מהירה ממסך הבית</p>
      <button type="button" onClick={() => void install()} className="pressable min-h-10 shrink-0 rounded-xl bg-ink px-3.5 text-sm font-semibold text-inverse">
        התקן את האפליקציה
      </button>
      <button
        type="button"
        onClick={() => {
          dismissBanner()
          setHidden(true)
        }}
        className="pressable grid size-10 shrink-0 place-items-center rounded-xl text-ink-3"
        aria-label="לא עכשיו"
      >
        <X className="size-4" />
      </button>
      {help}
    </div>
  )
}

/**
 * Manual steps for browsers without an install dialog (or before Chrome offers one).
 * Portalled to <body>: the banner animates in with a transform, which would otherwise
 * trap this fixed-position sheet inside the banner.
 */
export function InstallHelp({ open, onClose, platform }: { open: boolean; onClose: () => void; platform: Platform }) {
  return createPortal(
    <Sheet
      open={open}
      onClose={onClose}
      title="התקנת האפליקציה"
      footer={
        <PrimaryButton className="w-full" onClick={onClose}>
          הבנתי
        </PrimaryButton>
      }
    >
      <div className="flex flex-col gap-4 pt-1 pb-2 text-[15px] leading-relaxed">
        {platform === 'ios' ? (
          <ol className="flex flex-col gap-3">
            <Step n={1} icon={<Share className="size-5" />}>בספארי, לחץ על כפתור השיתוף בתחתית המסך.</Step>
            <Step n={2} icon={<SquarePlus className="size-5" />}>בחר <b>״הוספה למסך הבית״</b> ואשר.</Step>
          </ol>
        ) : (
          <>
            <ol className="flex flex-col gap-3">
              <Step n={1} icon={<EllipsisVertical className="size-5" />}>
                בכרום, פתח את תפריט הדפדפן <b>⋮</b> {platform === 'android' ? 'בפינה העליונה.' : 'בפינת החלון.'}
              </Step>
              <Step n={2} icon={<Download className="size-5" />}>
                בחר <b>״התקנת אפליקציה״</b> או <b>״הוספה למסך הבית״</b>, ואשר <b>״התקנה״</b>.
              </Step>
            </ol>
            {platform === 'android' && (
              <p className="rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
                בדפדפן של סמסונג: תפריט <b>☰</b> ← <b>״הוספת דף אל״</b> ← <b>״מסך הבית״</b>. אם פתחת את הקישור מתוך וואטסאפ או אינסטגרם, פתח אותו קודם בכרום.
              </p>
            )}
          </>
        )}
        <p className="text-sm text-ink-3">האפליקציה תופיע במסך הבית בשם Calorie Tracker ותיפתח בחלון משלה. ההתחברות והנתונים נשארים כמו שהם.</p>
      </div>
    </Sheet>,
    document.body,
  )
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2" aria-hidden>
        {icon}
      </span>
      <span className="pt-1.5">
        <span className="sr-only">שלב {n}: </span>
        {children}
      </span>
    </li>
  )
}
