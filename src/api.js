import { clearSession, getCsrfToken } from './session'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

const safeErrorMessage = (status, path, payload) => {
  const serverMessage = String(payload?.message || payload?.error || '').trim()
  const serverCode = String(payload?.code || payload?.error_code || '').toUpperCase()

  if (status === 401 && path === '/auth/login') return 'The email address or password is incorrect.'
  if (status === 401) return 'Authentication is required. Please sign in and try again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested information is no longer available.'
  if (status === 410) return 'This link is no longer available. Request a new invitation.'
  if (status === 409 && serverCode === 'INVENTORY_CHANGED') return serverMessage || 'Product availability changed. Review your bag and try again.'
  if (status === 409 && /contact-ownership|notification-verifications/.test(path)) return 'Customer details are already present. Reset the unverified values or sign in with the customer credentials.'
  if (status === 409) return 'This request conflicts with existing information. Refresh and try again.'
  if (status === 429) {
    const retrySeconds = Number(payload?.retry_after_seconds || payload?.retry_after || 0)
    if (retrySeconds > 0) {
      const minutes = Math.ceil(retrySeconds / 60)
      return retrySeconds < 60
        ? `Please wait ${retrySeconds} seconds before trying again.`
        : `Verification limit reached. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    return serverMessage || 'Too many attempts. Please wait before trying again.'
  }
  if (/EXPIRED/.test(serverCode) || /\bexpired\b/i.test(serverMessage)) return 'The verification code has expired.'
  if (/INVALID.*(?:CODE|TOKEN)|(?:CODE|TOKEN).*INVALID/.test(serverCode) || (/invalid|incorrect/i.test(serverMessage) && /code|token/i.test(serverMessage))) return 'The verification code is incorrect.'
  if (status === 400 || status === 422) return 'Check the information supplied and try again.'
  if (status >= 500) return 'The service is temporarily unavailable. Please try again.'
  return 'The request could not be completed. Please try again.'
}

async function request(path, options = {}) {
  const { auth = true, sameOrigin = false, ...fetchOptions } = options
  const method = String(fetchOptions.method || 'GET').toUpperCase()
  const csrfToken = !['GET', 'HEAD', 'OPTIONS'].includes(method) ? getCsrfToken() : ''
  const response = await fetch(`${sameOrigin ? '' : API_BASE}${path}`, {
    ...fetchOptions,
    credentials: sameOrigin ? 'omit' : 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...fetchOptions.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (auth && response.status === 401) {
    clearSession()
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (!response.ok) {
    const error = new Error(safeErrorMessage(response.status, path, payload))
    error.status = response.status
    error.code = String(payload.code || payload.error_code || '')
    error.details = {
      retry_after_seconds: payload.retry_after_seconds,
      retry_after: payload.retry_after,
    }
    error.retryAfter = response.headers.get('Retry-After')
    throw error
  }
  return payload.data ?? payload
}

export const authApi = {
  login: (email, password) => request('/auth/login', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  requestVerification: (destination, purpose, channel = 'EMAIL', invitationToken = '', checkoutId = '') => request('/notification-verifications/request', {
    auth: purpose === 'CHECKOUT' || purpose === 'ACCOUNT_CONTACT_CHANGE',
    method: 'POST',
    body: JSON.stringify({ channel, destination, purpose, ...(invitationToken ? { invitation_token: invitationToken } : {}), ...(checkoutId ? { checkout_id: checkoutId } : {}) }),
  }),
  verifyCode: (verificationId, code, auth = true, checkoutId = '') => request('/notification-verifications/verify', { auth, method: 'POST', body: JSON.stringify({ verification_id: verificationId, code, ...(checkoutId ? { checkout_id: checkoutId } : {}) }) }),
  checkContactOwnership: (contacts, authenticated = true) => request('/users/contact-ownership/check', { auth: authenticated, method: 'POST', body: JSON.stringify({ contacts }) }),
  register: (details) => request('/auth/register', { auth: false, method: 'POST', body: JSON.stringify(details) }),
  requestPasswordReset: (email) => request('/auth/password-reset/request', { auth: false, method: 'POST', body: JSON.stringify({ email }) }),
  confirmPasswordReset: (email, code, password) => request('/auth/password-reset/confirm', { auth: false, method: 'POST', body: JSON.stringify({ email, code, password }) }),
  invitation: (token) => request('/auth/invitations/inspect', { auth: false, method: 'POST', body: JSON.stringify({ invitation_token: token }) }),
  acceptInvitation: (details) => request('/auth/invitations/accept', { auth: false, method: 'POST', body: JSON.stringify(details) }),
  phoneAvailability: (countryCode, phone) => request(`/users/phone-availability?${new URLSearchParams({ country_code: countryCode, phone })}`, { auth: false }),
  session: () => request('/auth/session', { auth: false }),
}

const listQuery = () => new URLSearchParams({
  _start: '0',
  _end: '100',
}).toString()

export const catalogApi = {
  products: () => request(`/products?${listQuery()}`, { auth: false }),
  categories: () => request(`/categories?${listQuery()}`, { auth: false }),
  banners: () => request(`/storefront-highlights?${listQuery()}`, { auth: false, sameOrigin: true }),
  heart: (productId, guestSessionId = '') => request(`/products/${encodeURIComponent(productId)}/heart`, {
    method: 'POST',
    headers: guestSessionId ? { 'X-Guest-Session-Id': guestSessionId } : undefined,
  }),
}

export const cartApi = {
  load: async () => {
    const carts = await request('/carts')
    const cart = carts[0] || await request('/carts', { method: 'POST', body: '{}' })
    return request(`/carts/${encodeURIComponent(cart.id)}`)
  },
  get: (cartId) => request(`/carts/${encodeURIComponent(cartId)}`),
  add: (cartId, productId, productColorId, quantity = 1) => request('/cart-items', {
    method: 'POST',
    body: JSON.stringify({ cart_id: cartId, product_id: productId, product_color_id: productColorId, quantity }),
  }),
  update: (itemId, quantity) => request(`/cart-items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: JSON.stringify({ quantity }) }),
  remove: (itemId) => request(`/cart-items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  clear: async (cart) => Promise.all((cart.items || cart.cart_items || []).map((item) => request(`/cart-items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }))),
}

export const orderApi = {
  checkout: (details) => request('/orders', { method: 'POST', body: JSON.stringify(details) }),
  guestCheckout: (details, items) => request('/orders/guest', { auth: false, method: 'POST', body: JSON.stringify({ ...details, items }) }),
  list: () => request('/orders'),
  get: (orderNumber) => request(`/orders/${encodeURIComponent(orderNumber)}`),
  removeFromHistory: (orderId) => request(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
  resendSummary: (orderId, channel) => request(`/orders/${encodeURIComponent(orderId)}/notifications/resend`, { method: 'POST', body: JSON.stringify({ channel }) }),
  notificationStatus: (orderId, channel) => request(`/orders/${encodeURIComponent(orderId)}/notifications/status?channel=${encodeURIComponent(channel)}`),
  resendGuestSummary: (orderId, csrfToken) => request(`/orders/${encodeURIComponent(orderId)}/guest-notifications/resend`, { auth: false, method: 'POST', headers: { 'X-CSRF-Token': csrfToken } }),
  guestNotificationStatus: (orderId) => request(`/orders/${encodeURIComponent(orderId)}/guest-notifications/status`, { auth: false }),
  track: (orderNumber, channel, destination) => request('/orders/track', { auth: false, method: 'POST', body: JSON.stringify({ orderNumber, channel, destination }) }),
  verifyTracking: (trackingRequestId, code) => request('/orders/track', { auth: false, method: 'POST', body: JSON.stringify({ tracking_request_id: trackingRequestId, code }) }),
  requestAction: (orderId, details) => request(`/orders/${encodeURIComponent(orderId)}/actions`, { method: 'POST', body: JSON.stringify(details) }),
  requestGuestAction: (orderId, csrfToken, details) => request(`/orders/${encodeURIComponent(orderId)}/guest-actions`, { auth: false, method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(details) }),
}

export const paymentApi = {
  createStripeCheckout: (orderId, guestCsrfToken = '') => request(`/payments/orders/${encodeURIComponent(orderId)}/checkout`, { method: 'POST', headers: guestCsrfToken ? { 'X-CSRF-Token': guestCsrfToken } : undefined }),
  releaseReservation: (orderId, guestCsrfToken = '') => request(`/payments/orders/${encodeURIComponent(orderId)}/release`, { method: 'POST', headers: guestCsrfToken ? { 'X-CSRF-Token': guestCsrfToken } : undefined }),
  checkoutResult: (sessionId) => {
    return request('/payments/checkout-sessions/result', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) })
  },
  orderResult: (orderId) => request(`/payments/orders/${encodeURIComponent(orderId)}/payment`),
}

// Backed by the market_requirements table in the commerce API. Creation is
// public so guests can share demand; listing/updating must be admin-protected.
export const marketRequirementApi = {
  create: (details) => request('/market-requirements', { method: 'POST', body: JSON.stringify(details) }),
  list: () => request(`/market-requirements?${listQuery()}`),
  update: (id, details) => request(`/market-requirements/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(details) }),
}

export const marketingApi = {
  subscribe: (email, requestId) => request('/marketing', { auth: false, method: 'POST', body: JSON.stringify({ email, request_id: requestId }) }),
}

export const contactApi = {
  send: (details) => request('/contact', { auth: false, method: 'POST', body: JSON.stringify(details) }),
}
