import { create } from 'zustand'
import { navigate } from '../../lib/router'

/*
  Which tab of the account page is open. It is not in the address (the page is always /account); it is remembered for
  the visit (sessionStorage), so leaving for a game and coming back returns to the same tab, and a new visit starts on
  the Overview. Anything in the app can open the page on a tab with openAccount (the session reminder opens
  Responsible play). Kept apart from the page so importing it doesn't load the page.
*/

export type AccountTab = 'overview' | 'customize' | 'shop' | 'stats' | 'history' | 'achievements' | 'settings' | 'limits'

export const ACCOUNT_TABS: { id: AccountTab; name: string; short: string }[] = [
  { id: 'overview', name: 'Overview', short: 'Overview' },
  { id: 'customize', name: 'Customize', short: 'Customize' },
  { id: 'shop', name: 'Shop', short: 'Shop' },
  { id: 'stats', name: 'Statistics', short: 'Stats' },
  { id: 'history', name: 'History', short: 'History' },
  { id: 'achievements', name: 'Achievements', short: 'Badges' },
  { id: 'settings', name: 'Settings & security', short: 'Settings' },
  { id: 'limits', name: 'Responsible play', short: 'Limits' },
]

const KEY = 'boje.account.tab'
const read = (): AccountTab => {
  try {
    const v = sessionStorage.getItem(KEY)
    return ACCOUNT_TABS.some((t) => t.id === v) ? (v as AccountTab) : 'overview'
  } catch {
    return 'overview'
  }
}

export const useAccountTab = create<{ tab: AccountTab; setTab: (t: AccountTab) => void }>()((set) => ({
  tab: read(),
  setTab: (tab) => {
    try {
      sessionStorage.setItem(KEY, tab)
    } catch {
      /* private mode: remembered for this page only */
    }
    set({ tab })
  },
}))

/** opens the account page on a tab */
export function openAccount(tab: AccountTab) {
  useAccountTab.getState().setTab(tab)
  navigate('/account')
}
