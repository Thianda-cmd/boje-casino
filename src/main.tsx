import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App'
import { bootAccount, initAccount } from './lib/account'
import { bootDone } from './lib/boot'

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

// the first page lifts the boot screen when it mounts (lib/boot.ts); this only catches a page that never arrives
setTimeout(bootDone, 8000)
