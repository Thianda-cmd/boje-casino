import { create } from 'zustand'

/* Who is playing. Guests play on this device only; a signed-in player's wallet is kept on the
   server and follows them to any device. The actions live in lib/account.ts. */

export type AuthStatus = 'loading' | 'guest' | 'user'
export type AuthView = 'login' | 'register' | 'forgot' | 'reset'

export interface Profile {
  username: string
  avatar: number
  createdAt: string
}

interface AuthState {
  status: AuthStatus
  /** false when this build has no backend (the offline preview): accounts are hidden */
  available: boolean
  uid: string | null
  email: string | null
  profile: Profile | null
  /** wallet sync with the server */
  sync: 'idle' | 'saving' | 'error'
  view: AuthView | null
  open: (v: AuthView) => void
  close: () => void
}

export const useAuth = create<AuthState>()((set) => ({
  status: 'loading',
  available: true,
  uid: null,
  email: null,
  profile: null,
  sync: 'idle',
  view: null,
  open: (view) => set({ view }),
  close: () => set({ view: null }),
}))
