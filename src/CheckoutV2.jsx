import { useEffect, useMemo, useState } from 'react'
import { authApi, orderApi, paymentApi } from './api'

const STRIPE_PAYMENTS_ENABLED = import.meta.env.VITE_STRIPE_PAYMENTS_ENABLED === 'true'
const GUEST_CHECKOUT_ENABLED = import.meta.env.VITE_GUEST_CHECKOUT_ENABLED === 'true'
const WHATSAPP_ENABLED = import.meta.env.VITE_WHATSAPP_ENABLED === 'true'
const toE164 = (value, defaultCountryCode = '65') => {
  const raw = String(value || '').trim(), digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  if (raw.startsWith('00')) return `+${digits.slice(2)}`
  return digits.length === 8 ? `+${defaultCountryCode}${digits}` : `+${digits}`
}
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
const isValidPhone = (value) => {
  const raw = String(value || '').trim()
  return !raw || /^\+?[\d\s().-]+$/.test(raw) && /^\+[1-9]\d{7,14}$/.test(toE164(raw))
}
const isCustomerConflict = (failure) => failure?.status === 409 || /already (?:exists|registered)|belongs to (?:a )?customer|customer account/i.test(failure?.message || '')
const channelName = (channel) => channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'SMS' ? 'SMS' : 'email'
const pendingKey = (userId) => `pendingStripeOrder:${userId}`

function Summary({ cart, total }) {
  const delivery = total >= 30 ? 0 : 5
  return <aside className="order-summary"><div className="summary-head"><h2>Your order</h2><span>{cart.length} items</span></div>{cart.map((item) => <div className="summary-item" key={`${item.id}:${item.productColorId ?? 'none'}`}><p><strong>{item.name}</strong><span>Quantity {item.quantity}</span></p><em>S${(item.price * item.quantity).toFixed(2)}</em></div>)}<div className="summary-lines"><p><span>Delivery</span><b>{delivery ? `S$${delivery.toFixed(2)}` : 'Complimentary'}</b></p></div><div className="summary-total"><span>Total</span><strong>S${(total + delivery).toFixed(2)}</strong></div></aside>
}

export default function CheckoutV2({ cart, total, mode, setMode, user, isLoggedIn, onConfirm, confirmed, confirmationReference, go, onSignIn }) {
  const [email, setEmail] = useState(isLoggedIn ? user?.email || '' : '')
  const [phone, setPhone] = useState(isLoggedIn ? user?.phone || '' : '')
  const [whatsapp, setWhatsapp] = useState(isLoggedIn ? user?.whatsapp_number || user?.phone || '' : '')
  const [sameAsMobile, setSameAsMobile] = useState(() => !user?.whatsapp_number || user?.whatsapp_number === user?.phone)
  const [extraChannels, setExtraChannels] = useState([])
  const [verificationIds, setVerificationIds] = useState({})
  const [verificationCodes, setVerificationCodes] = useState({})
  const [verificationTokens, setVerificationTokens] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [customerConflict, setCustomerConflict] = useState(false)
  const [confirmedOrder, setConfirmedOrder] = useState(null)
  const destinations = useMemo(() => ({ EMAIL: email.trim().toLowerCase(), ...(toE164(phone) ? { SMS: toE164(phone) } : {}), ...(toE164(whatsapp) ? { WHATSAPP: toE164(whatsapp) } : {}) }), [email, phone, whatsapp])
  const invalidContacts = [
    !isValidEmail(email) && 'email address',
    !isValidPhone(phone) && 'SMS number',
    WHATSAPP_ENABLED && !isValidPhone(whatsapp) && 'WhatsApp number',
  ].filter(Boolean)
  const hasInvalidContact = invalidContacts.length > 0
  const suppliedChannels = Object.keys(destinations).filter((channel) => destinations[channel])
  const accountVerified = (channel) => {
    if (!isLoggedIn) return false
    const saved = channel === 'EMAIL' ? String(user?.email || '').toLowerCase() : channel === 'SMS' ? toE164(user?.phone) : toE164(user?.whatsapp_number)
    const verified = channel === 'EMAIL' ? user?.email_verified_at : channel === 'SMS' ? user?.phone_verified_at : user?.whatsapp_verified_at
    return Boolean(verified && destinations[channel] === saved)
  }
  const verified = (channel) => accountVerified(channel) || Boolean(verificationTokens[channel])
  const allVerified = !hasInvalidContact && suppliedChannels.every(verified)
  const clearProof = (...channels) => {
    const withoutChannels = (current) => Object.fromEntries(Object.entries(current).filter(([channel]) => !channels.includes(channel)))
    setVerificationIds(withoutChannels)
    setVerificationCodes(withoutChannels)
    setVerificationTokens(withoutChannels)
    setCustomerConflict(false)
    setError('')
    setMessage('')
  }
  const updatePhone = (value) => { setPhone(value); clearProof('SMS', ...(sameAsMobile ? ['WHATSAPP'] : [])); if (sameAsMobile) setWhatsapp(value); if (!value) setExtraChannels((current) => current.filter((channel) => channel !== 'SMS')) }
  const toggleSame = (checked) => { setSameAsMobile(checked); if (checked) { setWhatsapp(phone); clearProof('WHATSAPP') } }
  const updateWhatsapp = (value) => { setWhatsapp(value); clearProof('WHATSAPP'); if (!value) setExtraChannels((current) => current.filter((channel) => channel !== 'WHATSAPP')) }
  const showCustomerConflict = () => {
    setCustomerConflict(true)
    setVerificationIds({}); setVerificationCodes({}); setVerificationTokens({}); setExtraChannels([])
    setError(''); setMessage('')
  }

  const requestCode = async (channel) => {
    if (hasInvalidContact) { setError(`Correct or clear the invalid ${invalidContacts.join(', ')} before verifying any contact.`); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const channelsToCheck = suppliedChannels.filter((suppliedChannel) => !verified(suppliedChannel))
      const results = await Promise.all(channelsToCheck.map(async (suppliedChannel) => ({
        channel: suppliedChannel,
        result: await authApi.requestVerification(destinations[suppliedChannel], 'CHECKOUT', suppliedChannel),
      })))
      setVerificationIds(Object.fromEntries(results.filter((entry) => entry.result.verification_id).map((entry) => [entry.channel, entry.result.verification_id])))
      setMessage(results.length > 1 ? 'Six-digit codes were sent to each supplied contact.' : results[0]?.result.verified ? `${channelName(channel)} is already verified.` : `A six-digit code was sent by ${channelName(channel)}.`)
    } catch (failure) {
      if (isCustomerConflict(failure)) showCustomerConflict()
      else setError(failure.message)
    }
    finally { setBusy(false) }
  }
  const confirmCode = async (channel) => {
    if (hasInvalidContact) { setError(`Correct or clear the invalid ${invalidContacts.join(', ')} before verifying any contact.`); return }
    setBusy(true); setError('')
    try { const result = await authApi.verifyCode(verificationIds[channel], verificationCodes[channel], isLoggedIn); setVerificationTokens((current) => ({ ...current, [channel]: result.verification_token })); setMessage(`${channelName(channel)} verified for this checkout.`) }
    catch (failure) { if (isCustomerConflict(failure)) showCustomerConflict(); else setError(failure.message) }
    finally { setBusy(false) }
  }
  const toggleExtra = (channel) => setExtraChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel])
  const resetContactDetails = (event) => {
    event.currentTarget.form?.reset()
    setEmail(''); setPhone(''); setWhatsapp(''); setSameAsMobile(true); setExtraChannels([])
    setVerificationIds({}); setVerificationCodes({}); setVerificationTokens({})
    setCustomerConflict(false); setError(''); setMessage('')
  }

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (!STRIPE_PAYMENTS_ENABLED) throw new Error('Online payments are temporarily unavailable.')
      if (!allVerified) throw new Error('Verify every supplied contact before placing the order.')
      if (extraChannels.some((channel) => !destinations[channel] || !verified(channel))) throw new Error('Additional notification channels must be supplied and verified.')
      const storageKey = pendingKey(user?.id || 'guest')
      let pending
      try { pending = JSON.parse(sessionStorage.getItem(storageKey)) } catch { pending = null }
      if (pending?.id) {
        try {
          const previousOrder = await paymentApi.orderResult(pending.id, pending.accessToken)
          if (previousOrder.payment_status === 'PAID') throw new Error('This payment is already complete. Open your orders to view it.')
          if (previousOrder.status === 'CANCELLED') {
            sessionStorage.removeItem(storageKey)
            throw new Error('Your previous payment reservation expired. Review availability, then press pay again to create a new reservation.')
          }
        } catch (failure) {
          if ([403, 404].includes(failure.status)) {
            sessionStorage.removeItem(storageKey)
            throw new Error('The previous payment reservation is no longer available. Review your bag, then press pay again.', { cause: failure })
          }
          throw failure
        }
      }
      if (!pending?.id) {
        const details = { shipping_name: data.get('name'), shipping_phone: toE164(phone), shipping_address: data.get('shippingAddress'), contact_email: destinations.EMAIL, contact_phone: destinations.SMS || '', contact_whatsapp: destinations.WHATSAPP || '', payment_method: 'STRIPE', notification_channels: ['EMAIL', ...extraChannels], notification_verification_tokens: verificationTokens }
        const items = cart.map(({ id, productColorId, quantity }) => ({ product_id: id, product_color_id: productColorId, quantity }))
        const order = isLoggedIn ? await orderApi.checkout({ ...details, items }) : await orderApi.guestCheckout(details, items)
        pending = { id: order.id, accessToken: order.order_access_token || '' }
        sessionStorage.setItem(storageKey, JSON.stringify(pending))
      }
      const result = await paymentApi.createStripeCheckout(pending.id, pending.accessToken)
      if (!result.checkout_url) throw new Error('The payment service did not return a checkout URL.')
      window.location.assign(result.checkout_url)
    } catch (failure) { setError(failure.message || 'Checkout could not be started.'); setBusy(false) }
  }

  useEffect(() => {
    if (!confirmed) return
    const sessionId = new URLSearchParams(window.location.search).get('session_id')
    let saved
    try { saved = JSON.parse(sessionStorage.getItem(pendingKey(user?.id || 'guest'))) } catch { saved = null }
    const pending = confirmationReference || saved
    const request = sessionId ? paymentApi.checkoutResult(sessionId) : pending?.id ? paymentApi.orderResult(pending.id, pending.accessToken) : Promise.reject(new Error('Order reference is unavailable.'))
    request.then((result) => {
      setConfirmedOrder(result)
      if (result.payment_status === 'PAID') onConfirm(pending)
      else setError('Payment confirmation is still pending. Refresh this page in a moment before leaving.')
    }).catch((failure) => setError(failure.message))
  }, [confirmed, confirmationReference, onConfirm, user?.id])

  if (confirmed) {
    const paid = confirmedOrder?.payment_status === 'PAID'
    const canShowOrderReference = isLoggedIn || Boolean(confirmationReference?.accessToken)
    return <main className="confirmation"><div className="success-mark">✓</div><h1>{paid ? 'Thank you for choosing handmade.' : 'Confirming your payment.'}</h1><p>{paid ? 'Your order details will always be emailed, with any additional selected updates sent separately.' : 'Your reserved items are held briefly while Stripe confirms payment.'}</p>{paid && canShowOrderReference && confirmedOrder?.order_number && <div className="order-number"><span>Order number</span><strong>{confirmedOrder.order_number}</strong></div>}{paid && !canShowOrderReference && <p className="verification-note">Sign in to view this customer order in My orders.</p>}{error && <p className="payment-error">{error}</p>}<button className="primary" onClick={() => paid ? go(isLoggedIn ? 'orders' : 'track') : window.location.reload()}>{paid ? 'Continue' : 'Check again'}</button></main>
  }

  const orderTotal = total + (total >= 30 ? 0 : 5)
  return <main className="checkout-page"><div className="checkout-heading"><button className="back" onClick={() => go('shop')}>← Back to shop</button><h1>Checkout</h1><p>Email updates are always included. Add verified SMS or WhatsApp updates if you wish.</p></div><div className="checkout-layout"><section className="checkout-form"><div className="mode-tabs"><button className={mode === 'guest' ? 'active' : ''} disabled={isLoggedIn || !GUEST_CHECKOUT_ENABLED} onClick={() => setMode('guest')}>Guest checkout</button><button className={mode === 'customer' ? 'active' : ''} disabled={!isLoggedIn} onClick={() => setMode('customer')}>Customer checkout</button></div>
    <form onSubmit={submit}><h2>Contact and delivery details</h2><div className="field-grid"><label>Full name<input required name="name" defaultValue={isLoggedIn ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim() : ''}/></label><label>Email address *<input required type="email" value={email} readOnly={isLoggedIn} aria-invalid={!isValidEmail(email)} onChange={(event) => { setEmail(event.target.value); clearProof('EMAIL') }}/></label><label>SMS phone (optional)<input type="tel" value={phone} aria-invalid={!isValidPhone(phone)} onChange={(event) => updatePhone(event.target.value)} placeholder="+6591234567"/></label>{WHATSAPP_ENABLED && <><label className="checkbox"><input type="checkbox" checked={sameAsMobile} onChange={(event) => toggleSame(event.target.checked)}/> WhatsApp same as mobile</label><label>WhatsApp (optional)<input type="tel" value={whatsapp} disabled={sameAsMobile} aria-invalid={!isValidPhone(whatsapp)} onChange={(event) => updateWhatsapp(event.target.value)} placeholder="+6591234567"/></label></>}<label className="wide">Shipping address<textarea required name="shippingAddress"/></label></div>
      <section className="notification-confirmation"><h2>Verify supplied contacts</h2>{hasInvalidContact && !customerConflict && <p className="payment-error" role="alert">Correct or clear the invalid {invalidContacts.join(', ')} before verifying any contact.</p>}{customerConflict && <div role="alert"><p className="payment-error">Customer details are already present. Reset all values or sign in with the customer credentials.</p><div className="registration-verification"><button className="secondary" type="button" onClick={resetContactDetails}>Reset all values</button>{onSignIn && <button className="secondary" type="button" onClick={onSignIn}>Customer sign in</button>}</div></div>}{suppliedChannels.map((channel) => <div className="registration-verification" key={channel}><button className="secondary" type="button" disabled={busy || hasInvalidContact || customerConflict || verified(channel)} onClick={() => requestCode(channel)}>{verified(channel) ? `${channelName(channel)} verified` : verificationIds[channel] ? 'Resend code' : `Send ${channelName(channel)} code`}</button>{verificationIds[channel] && !verified(channel) && <><input aria-label={`${channel} code`} inputMode="numeric" maxLength="6" value={verificationCodes[channel] || ''} onChange={(event) => setVerificationCodes((current) => ({ ...current, [channel]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}/><button className="secondary" type="button" disabled={busy || hasInvalidContact || customerConflict || (verificationCodes[channel] || '').length !== 6} onClick={() => confirmCode(channel)}>Verify</button></>}</div>)}</section>
      <section className="notification-confirmation"><h2>Order notifications</h2><label className="checkbox"><input type="checkbox" checked readOnly/> Email (required)</label><label className="checkbox"><input type="checkbox" checked={extraChannels.includes('SMS')} disabled={!destinations.SMS || !verified('SMS')} onChange={() => toggleExtra('SMS')}/> Add SMS</label>{WHATSAPP_ENABLED && <label className="checkbox"><input type="checkbox" checked={extraChannels.includes('WHATSAPP')} disabled={!destinations.WHATSAPP || !verified('WHATSAPP')} onChange={() => toggleExtra('WHATSAPP')}/> Add WhatsApp</label>}</section>
      {message && <p className="verification-note">{message}</p>}{error && <p className="payment-error">{error}</p>}<button className="primary full" disabled={!STRIPE_PAYMENTS_ENABLED || busy || !cart.length || !allVerified}>{busy ? 'Please wait…' : `Reserve items & pay S$${orderTotal.toFixed(2)}`}</button>
    </form></section><Summary cart={cart} total={total}/></div></main>
}
