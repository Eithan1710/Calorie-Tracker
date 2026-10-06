import { useState } from 'react'
import { updateSettings } from '../../data/store'
import { bmrMifflinStJeor, isValidProfile, type Profile } from '../../domain/energy'
import { PrimaryButton, NumberField } from '../primitives'
import { ProfileFields } from '../sheets/SettingsSheet'
import { fmt } from '../format'

export function Logo({ className = 'size-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--ink)" />
      <path d="M14 38h36" stroke="var(--on-ink)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="25" cy="27" r="7" fill="var(--eaten)" />
      <circle cx="40" cy="27" r="7" fill="none" stroke="var(--on-ink)" strokeWidth="4" />
      <path d="M32 38v10" stroke="var(--on-ink)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

export function Onboarding() {
  const [p, setP] = useState<Partial<Profile>>({ sex: 'male' })
  const [protein, setProtein] = useState<number | ''>(120)
  const valid = isValidProfile(p) && protein !== '' && protein >= 40

  return (
    <main className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
      <div className="animate-rise flex flex-1 flex-col justify-center gap-7 py-8">
        <div className="flex flex-col gap-4">
          <Logo className="size-14" />
          <div>
            <h1 className="text-[34px] leading-tight font-bold tracking-tight">מאזן</h1>
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
            if (isValidProfile(p) && protein !== '') updateSettings({ profile: p, proteinTarget: protein })
          }}
        >
          בוא נתחיל
        </PrimaryButton>
        <p className="text-center text-sm text-ink-3">הכל נשמר במכשיר שלך. אפשר לשנות בכל רגע בהגדרות.</p>
      </div>
    </main>
  )
}
