const TOKEN_KEY = 'authToken'
const USER_KEY = 'authUser'
const MODE_KEY = 'sessionMode'

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
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export const startGuestSession = () => {
  removeUserCredentials()
  localStorage.setItem(MODE_KEY, SESSION_MODE.GUEST)
}

export const clearSession = startGuestSession

export const getSessionToken = () => {
  const mode = localStorage.getItem(MODE_KEY)
  if (mode === SESSION_MODE.GUEST) {
    removeUserCredentials()
    return null
  }

  const token = localStorage.getItem(TOKEN_KEY)
  const claims = token && decodeClaims(token)
  if (!claims?.exp || claims.exp * 1000 <= Date.now()) {
    startGuestSession()
    return null
  }

  localStorage.setItem(MODE_KEY, SESSION_MODE.USER)
  return token
}

export const getSessionUser = () => {
  if (!getSessionToken()) return null
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY))
    if (!user) throw new Error('Missing session user')
    return user
  } catch {
    startGuestSession()
    return null
  }
}

export const saveSession = ({ token, user }) => {
  const claims = token && decodeClaims(token)
  if (!user || !claims?.exp || claims.exp * 1000 <= Date.now()) throw new Error('The server returned an invalid session.')

  removeUserCredentials()
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  localStorage.setItem(MODE_KEY, SESSION_MODE.USER)
}
