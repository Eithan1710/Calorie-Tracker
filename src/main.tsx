import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startSession } from './services/session'
import { initInstall } from './services/install'

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// before anything else: the browser fires its install event once per page load
initInstall()

// auth → per-account local store → sync
startSession()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    // A new version is downloaded in the background. It takes over the next time the app is
    // backgrounded (switching apps, locking the phone), so nothing typed is ever lost to a reload,
    // and an installed app never stays on an old version.
    let updateReady = false
    const applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady = true
        if (document.visibilityState === 'hidden') void applyUpdate(true)
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return
        const check = () => void registration.update().catch(() => {})
        setInterval(check, 60 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
          else if (updateReady) void applyUpdate(true)
        })
      },
    })
  })
}
