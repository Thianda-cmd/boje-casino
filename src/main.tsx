import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App'
import { bootAccount, initAccount } from './lib/account'

// show a returning player's cached wallet straight away, then check the session in the background
bootAccount()
void initAccount()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)

// the boot screen in index.html stays up a moment so it never just flickers, then fades out
const boot = document.getElementById('boot')
if (boot)
  setTimeout(
    () => {
      boot.classList.add('gone')
      setTimeout(() => boot.remove(), 500)
    },
    Math.max(150, 900 - performance.now()),
  )
