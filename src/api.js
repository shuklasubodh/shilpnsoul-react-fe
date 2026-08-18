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
  get: () => request('/cart'),
  add: (productId, quantity = 1) => request('/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity }) }),
  update: (itemId, quantity) => request(`/cart/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ quantity }) }),
  remove: (itemId) => request(`/cart/items/${itemId}`, { method: 'DELETE' }),
  clear: () => request('/cart', { method: 'DELETE' }),
}

export const orderApi = {
  checkout: (details) => request('/orders', { method: 'POST', body: JSON.stringify(details) }),
  guestCheckout: (details, items) => request('/orders/guest', { auth: false, method: 'POST', body: JSON.stringify({ ...details, items }) }),
  list: () => request('/orders'),
  get: (orderNumber) => request(`/orders/${encodeURIComponent(orderNumber)}`),
  track: (orderNumber, contact) => request('/orders/track', { auth: false, method: 'POST', body: JSON.stringify({ orderNumber, ...contact }) }),
}

export const paymentApi = {
  createStripeCheckout: (orderId) => request(`/payments/orders/${encodeURIComponent(orderId)}/checkout`, { method: 'POST' }),
}
