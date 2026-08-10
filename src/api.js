const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

async function request(path, options = {}) {
  const token = localStorage.getItem('authToken')
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
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
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
}

const listQuery = () => new URLSearchParams({
  _start: '0',
  _end: '100',
}).toString()

export const catalogApi = {
  products: () => request(`/products?${listQuery()}`),
  categories: () => request(`/categories?${listQuery()}`),
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
  guestCheckout: (details, items) => request('/orders/guest', { method: 'POST', body: JSON.stringify({ ...details, items }) }),
  list: () => request('/orders'),
  get: (orderNumber) => request(`/orders/${encodeURIComponent(orderNumber)}`),
  track: (orderNumber, contact) => request('/orders/track', { method: 'POST', body: JSON.stringify({ orderNumber, ...contact }) }),
}
