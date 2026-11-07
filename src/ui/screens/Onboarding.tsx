import { useState } from 'react'
import { logProfileWeight, updateSettings, useStore } from '../../data/store'
import { pushProfile } from '../../services/sync'
import { useAuth } from '../../services/auth'
import { bmrMifflinStJeor, isValidProfile, type Profile } from '../../domain/energy'
import { PrimaryButton, NumberField } from '../primitives'
import { ProfileFields } from '../sheets/SettingsSheet'
import { fmt } from '../format'

/** The app icon (same mark as the favicon, the home-screen icon and the share image). */
export function Logo({ className = 'size-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#17181b" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="5" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeDasharray="98.9 33" transform="rotate(-90 32 32)" />
      <path fill="#e2733d" d="M32.6 18.5c.9 4.3 3.5 6.7 5.9 9.4 2.3 2.6 3.9 5.2 3.9 8.7 0 5.9-4.6 10-10.4 10s-10.4-4.1-10.4-9.6c0-3.3 1.4-6 3.7-8.3.2 2.4 1.2 4.2 3.1 5.3-.5-5.6 1.4-10.3 4.2-15.5z" />
      <path fill="#fff" fillOpacity="0.9" d="M32.3 34.6c1.9 1.9 3.6 3.5 3.6 6 0 2.2-1.7 3.8-3.9 3.8s-3.9-1.5-3.9-3.6c0-1.6.8-2.8 2-3.8.3 1 .9 1.6 1.7 1.9-.3-1.5 0-3 .5-4.3z" />
    </svg>
  )
}

export function Onboarding() {
  const auth = useAuth()
  const signedIn = useStore((s) => s.userId) !== null
  const [p, setP] = useState<Partial<Profile>>({ sex: 'male' })
  const [protein, setProtein] = useState<number | ''>(120)
  const valid = isValidProfile(p) && protein !== '' && protein >= 40

  return (
    <main className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
      <div className="animate-rise flex flex-1 flex-col justify-center gap-7 py-8">
        <div className="flex flex-col gap-4">
          <Logo className="size-14" />
          <div>
            <h1 className="text-[34px] leading-tight font-bold tracking-tight">{auth.username ? `שלום, ${auth.username}` : 'מאזן'}</h1>
            <p className="mt-1 text-lg text-ink-2">כמה נכנס, כמה נשרף, כמה חלבון. 10 שניות ביום.</p>
          </div>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <p className="font-medium">4 פרטים כדי לחשב כמה אתה שורף:</p>
          <ProfileFields value={p} onChange={setP} />
          <NumberField label="יעד חלבון יומי" unit="ג׳" value={protein} onChange={setProtein} inputMode="numeric" />
          {isValidProfile(p) && (
            <p className="text-sm text-ink-3">
              חילוף חומרים במנוחה: ~{fmt(bmrMifflinStJeor(p))} קק״ל. היעד: גירעון מתון של <span className="ltr">100–300</span> קק״ל ביום.
            </p>
          )}
        </div>

        <PrimaryButton
          disabled={!valid}
          onClick={() => {
            if (isValidProfile(p) && protein !== '') {
              updateSettings({ profile: p, proteinTarget: protein })
              void pushProfile()
              logProfileWeight(p.weightKg) // the first weigh-in of the weight log
            }
          }}
        >
          בוא נתחיל
        </PrimaryButton>
        <p className="text-center text-sm text-ink-3">
          {signedIn ? 'נשמר בחשבון שלך ומשמש רק לחישובים שלך.' : 'הכל נשמר במכשיר שלך.'} אפשר לשנות בכל רגע בהגדרות.
        </p>
      </div>
    </main>
  )
}
