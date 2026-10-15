const USER_KEY = 'authUser'
const CSRF_KEY = 'authCsrfToken'
const MODE_KEY = 'sessionMode'
const GUEST_SESSION_KEY = 'guestSessionId'

export const SESSION_MODE = Object.freeze({ GUEST: 'guest', USER: 'user' })

const removeUserCredentials = () => {
  sessionStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(CSRF_KEY)
  sessionStorage.removeItem('authToken')
  localStorage.removeItem('authToken')
  localStorage.removeItem(USER_KEY)
}

const createGuestSessionId = () => {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) throw new Error('Secure guest sessions are unavailable in this browser.')
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
export const getCsrfToken = () => sessionStorage.getItem(CSRF_KEY) || ''

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

export const getSessionUser = () => {
  if (sessionStorage.getItem(MODE_KEY) !== SESSION_MODE.USER) return null
  try {
    const user = JSON.parse(sessionStorage.getItem(USER_KEY))
    if (!user) throw new Error('Missing session user')
    return user
  } catch {
    removeUserCredentials()
    return null
  }
}

export const saveSession = ({ user, csrf_token: csrfToken }) => {
  if (!user || !csrfToken) throw new Error('The server returned an invalid session.')
  removeUserCredentials()
  removeGuestSessionData(sessionStorage.getItem(GUEST_SESSION_KEY))
  sessionStorage.removeItem(GUEST_SESSION_KEY)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  sessionStorage.setItem(CSRF_KEY, csrfToken)
  sessionStorage.setItem(MODE_KEY, SESSION_MODE.USER)
}
