import { clearSession, getSessionToken } from './session'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

async function request(path, options = {}) {
  const { auth = true, ...fetchOptions } = options
  const token = auth ? getSessionToken() : null
  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 && token) {
    clearSession()
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || 'Something went wrong')
    error.status = response.status
    error.details = payload
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
  requestVerification: (destination, purpose) => request('/notification-verifications/request', { auth: purpose !== 'REGISTRATION', method: 'POST', body: JSON.stringify({ channel: 'EMAIL', destination, purpose }) }),
  verifyCode: (verificationId, code, auth = true) => request('/notification-verifications/verify', { auth, method: 'POST', body: JSON.stringify({ verification_id: verificationId, code }) }),
  register: (details) => request('/auth/register', { auth: false, method: 'POST', body: JSON.stringify(details) }),
  session: () => request('/auth/session'),
}

const listQuery = () => new URLSearchParams({
  _start: '0',
  _end: '100',
}).toString()

export const catalogApi = {
  products: () => request(`/products?${listQuery()}`, { auth: false }),
  categories: () => request(`/categories?${listQuery()}`, { auth: false }),
  banners: () => request(`/banners?${listQuery()}`, { auth: false }),
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
  resendSummary: (orderId) => request(`/orders/${encodeURIComponent(orderId)}/notifications/resend`, { method: 'POST' }),
  resendGuestSummary: (orderId, accessToken) => request(`/orders/${encodeURIComponent(orderId)}/guest-notifications/resend`, { auth: false, method: 'POST', headers: { 'X-Order-Access-Token': accessToken } }),
  track: (orderNumber, email) => request('/orders/track', { auth: false, method: 'POST', body: JSON.stringify({ orderNumber, email }) }),
}

export const paymentApi = {
  createStripeCheckout: (orderId, orderAccessToken) => request(`/payments/orders/${encodeURIComponent(orderId)}/checkout`, { method: 'POST', headers: orderAccessToken ? { 'X-Order-Access-Token': orderAccessToken } : undefined }),
}
