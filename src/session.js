const TOKEN_KEY = 'authToken'
const USER_KEY = 'authUser'
const MODE_KEY = 'sessionMode'
const GUEST_SESSION_KEY = 'guestSessionId'

export const SESSION_MODE = Object.freeze({ GUEST: 'guest', USER: 'user' })

const decodeClaims = (token) => {
  try {
    const payload = token.split('.')[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
  } catch {
    return null
  }
}

const removeUserCredentials = () => {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

const createGuestSessionId = () => globalThis.crypto?.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`

const guestCartKey = (guestSessionId) => `shoppingCart:guest:${guestSessionId}`
const guestPendingOrderKey = (guestSessionId) => `pendingStripeOrder:guest:${guestSessionId}`

const removeGuestSessionData = (guestSessionId) => {
  if (!guestSessionId) return
  sessionStorage.removeItem(guestCartKey(guestSessionId))
  sessionStorage.removeItem(guestPendingOrderKey(guestSessionId))
}

export const getGuestSessionId = () => {
  let guestSessionId = sessionStorage.getItem(GUEST_SESSION_KEY)
  if (!guestSessionId) {
    guestSessionId = createGuestSessionId()
    sessionStorage.setItem(GUEST_SESSION_KEY, guestSessionId)
  }
  return guestSessionId
}

export const getGuestCartStorageKey = () => guestCartKey(getGuestSessionId())
export const getPendingOrderStorageKey = (userId) => userId ? `pendingStripeOrder:${userId}` : guestPendingOrderKey(getGuestSessionId())

export const startGuestSession = () => {
  removeUserCredentials()
  getGuestSessionId()
  sessionStorage.setItem(MODE_KEY, SESSION_MODE.GUEST)
}

export const startNewGuestSession = () => {
  removeUserCredentials()
  const previousGuestSessionId = sessionStorage.getItem(GUEST_SESSION_KEY)
  removeGuestSessionData(previousGuestSessionId)
  sessionStorage.setItem(GUEST_SESSION_KEY, createGuestSessionId())
  sessionStorage.setItem(MODE_KEY, SESSION_MODE.GUEST)
}

export const clearSession = startNewGuestSession

export const getSessionToken = () => {
  const mode = sessionStorage.getItem(MODE_KEY)
  if (mode === SESSION_MODE.GUEST) {
    removeUserCredentials()
    return null
  }

  const token = sessionStorage.getItem(TOKEN_KEY)
  const claims = token && decodeClaims(token)
  if (!claims?.exp || claims.exp * 1000 <= Date.now()) {
    startNewGuestSession()
    return null
  }

  sessionStorage.setItem(MODE_KEY, SESSION_MODE.USER)
  return token
}

export const getSessionUser = () => {
  if (!getSessionToken()) return null
  try {
    const user = JSON.parse(sessionStorage.getItem(USER_KEY))
    if (!user) throw new Error('Missing session user')
    return user
  } catch {
    startNewGuestSession()
    return null
  }
}

export const saveSession = ({ token, user }) => {
  const claims = token && decodeClaims(token)
  if (!user || !claims?.exp || claims.exp * 1000 <= Date.now()) throw new Error('The server returned an invalid session.')

  removeUserCredentials()
  removeGuestSessionData(sessionStorage.getItem(GUEST_SESSION_KEY))
  sessionStorage.removeItem(GUEST_SESSION_KEY)
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  sessionStorage.setItem(MODE_KEY, SESSION_MODE.USER)
}
