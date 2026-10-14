const STRIPE_CHECKOUT_HOSTS = new Set(['checkout.stripe.com'])

export const validatedStripeCheckoutUrl = (value) => {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new Error('The payment service returned an invalid checkout URL.')
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !STRIPE_CHECKOUT_HOSTS.has(url.hostname.toLowerCase())
  ) throw new Error('The payment service returned an invalid checkout URL.')

  return url.href
}

export const consumeStripeSessionId = () => {
  const url = new URL(window.location.href)
  const sessionId = url.searchParams.get('session_id') || ''
  if (sessionId) {
    url.searchParams.delete('session_id')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return sessionId
}
