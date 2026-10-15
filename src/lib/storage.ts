// localStorage can throw (private mode, blocked storage); never let that break the app.
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
