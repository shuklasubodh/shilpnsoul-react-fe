import { useEffect, useMemo, useState } from 'react'
import { authApi, orderApi, paymentApi } from './api'
import { getPendingOrderStorageKey } from './session'
import { consumeStripeSessionId, validatedStripeCheckoutUrl } from './security'

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
const CHANNEL_ORDER = ['EMAIL', 'SMS', 'WHATSAPP']
const withoutChannels = (current, channels) => Object.fromEntries(Object.entries(current).filter(([channel]) => !channels.includes(channel)))
const maskDestination = (channel, destination) => {
  if (channel === 'EMAIL') {
    const [name = '', domain = ''] = String(destination).split('@')
    return `${name.slice(0, 1)}${'*'.repeat(Math.max(3, name.length - 1))}@${domain}`
  }
  const value = String(destination || '')
  return value.length > 4 ? `${value.slice(0, Math.min(3, value.length - 4))} ${'*'.repeat(Math.max(4, value.length - 7))} ${value.slice(-4)}` : value
}
const retryDelayMs = (failure) => {
  const supplied = failure?.retryAfter || failure?.details?.retry_after_seconds || failure?.details?.retry_after
  if (Number.isFinite(Number(supplied))) return Math.max(1, Number(supplied)) * 1000
  const retryDate = Date.parse(supplied)
  return Number.isNaN(retryDate) ? 60000 : Math.max(1000, retryDate - Date.now())
}

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
  const [checkoutId, setCheckoutId] = useState('')
  const [serverVerifiedChannels, setServerVerifiedChannels] = useState({})
  const [selectedChannels, setSelectedChannels] = useState([])
  const [ownershipFingerprint, setOwnershipFingerprint] = useState('')
  const [retryUntil, setRetryUntil] = useState({})
  const [verifyRetryUntil, setVerifyRetryUntil] = useState({})
  const [clock, setClock] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [customerConflict, setCustomerConflict] = useState(false)
  const [confirmedOrder, setConfirmedOrder] = useState(null)
  const destinations = useMemo(() => ({ EMAIL: email.trim().toLowerCase(), ...(toE164(phone) ? { SMS: toE164(phone) } : {}), ...(WHATSAPP_ENABLED && toE164(whatsapp) ? { WHATSAPP: toE164(whatsapp) } : {}) }), [email, phone, whatsapp])
  const invalidContacts = [
    !isValidEmail(email) && 'email address',
    !isValidPhone(phone) && 'SMS number',
    WHATSAPP_ENABLED && !isValidPhone(whatsapp) && 'WhatsApp number',
  ].filter(Boolean)
  const hasInvalidContact = invalidContacts.length > 0
  const suppliedChannels = CHANNEL_ORDER.filter((channel) => destinations[channel] && (channel !== 'WHATSAPP' || WHATSAPP_ENABLED))
  const accountVerified = (channel) => {
    if (!isLoggedIn) return false
    const saved = channel === 'EMAIL' ? String(user?.email || '').toLowerCase() : channel === 'SMS' ? toE164(user?.phone) : toE164(user?.whatsapp_number)
    const verified = channel === 'EMAIL' ? user?.email_verified_at : channel === 'SMS' ? user?.phone_verified_at : user?.whatsapp_verified_at
    return Boolean(verified && destinations[channel] === saved)
  }
  const verified = (channel) => accountVerified(channel) || Boolean(verificationTokens[channel]) || Boolean(serverVerifiedChannels[channel])
  const currentChannel = CHANNEL_ORDER.find((channel) => selectedChannels.includes(channel) && !verified(channel))
  const verificationComplete = !hasInvalidContact && selectedChannels.every(verified)
  const contactFingerprint = JSON.stringify(destinations)
  const clearProof = (...channels) => {
    setVerificationIds((current) => withoutChannels(current, channels))
    setVerificationCodes((current) => withoutChannels(current, channels))
    setVerificationTokens((current) => withoutChannels(current, channels))
    setServerVerifiedChannels((current) => withoutChannels(current, channels))
    setRetryUntil((current) => withoutChannels(current, channels))
    setVerifyRetryUntil((current) => withoutChannels(current, channels))
    setSelectedChannels((current) => current.filter((channel) => !channels.includes(channel)))
    setOwnershipFingerprint('')
    setCustomerConflict(false)
    setError('')
    setMessage('')
  }
  const updatePhone = (value) => { if (sameAsMobile) setSameAsMobile(false); setPhone(value); clearProof('SMS'); if (!value) setExtraChannels((current) => current.filter((channel) => channel !== 'SMS')) }
  const toggleSame = (checked) => { setSameAsMobile(checked); if (checked) { setWhatsapp(phone); clearProof('WHATSAPP') } }
  const updateWhatsapp = (value) => { setWhatsapp(value); clearProof('WHATSAPP'); if (!value) setExtraChannels((current) => current.filter((channel) => channel !== 'WHATSAPP')) }
  const showCustomerConflict = () => {
    setCustomerConflict(true)
    setVerificationIds({}); setVerificationCodes({}); setVerificationTokens({}); setServerVerifiedChannels({}); setExtraChannels([])
    setCheckoutId('')
    setError(''); setMessage('')
  }
  const ensureContactOwnership = async () => {
    if (ownershipFingerprint === contactFingerprint) return true
    try {
      const ownership = await authApi.checkContactOwnership(destinations, isLoggedIn)
      const conflicts = ownership.conflicts || ownership.existing_channels || []
      if (ownership.available === false || ownership.has_conflict || conflicts.length) { showCustomerConflict(); return false }
      setOwnershipFingerprint(contactFingerprint)
      return true
    } catch (failure) {
      if (isCustomerConflict(failure)) { showCustomerConflict(); return false }
      if (!isLoggedIn && failure.status === 401) return 'DEFER_TO_CHANNEL'
      throw failure
    }
  }
  const toggleVerification = (channel, checked) => {
    if (!checked) { clearProof(channel); return }
    setSelectedChannels((current) => current.includes(channel) ? current : [...current, channel])
    setError(''); setMessage('')
  }

  const requestCode = async (channel) => {
    if (hasInvalidContact) { setError(`Correct or clear the invalid ${invalidContacts.join(', ')} before verifying any contact.`); return }
    if (channel !== currentChannel) { setError(`Complete ${channelName(currentChannel)} verification first.`); return }
    const cooldown = Math.max(0, Math.ceil(((retryUntil[channel] || 0) - Date.now()) / 1000))
    if (cooldown) { setError(`Please wait ${cooldown} seconds before requesting another ${channelName(channel)} code.`); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const ownershipResult = await ensureContactOwnership()
      if (ownershipResult === false) return
      if (ownershipResult === 'DEFER_TO_CHANNEL') {
        setError('Contact ownership cannot be checked right now. No code was sent. Please try again later or sign in with the customer credentials.')
        return
      }
      const purpose = isLoggedIn ? 'ACCOUNT_CONTACT_CHANGE' : 'CHECKOUT'
      const result = await authApi.requestVerification(destinations[channel], purpose, channel, '', checkoutId)
      if (result.checkout_id) setCheckoutId(result.checkout_id)
      if (result.verified) {
        setServerVerifiedChannels((current) => ({ ...current, [channel]: true }))
        setMessage(`${channelName(channel)} is already verified.`)
      } else {
        setVerificationCodes((current) => withoutChannels(current, [channel]))
        setVerificationIds((current) => ({ ...current, [channel]: result.verification_id }))
        setMessage(`A six-digit code was sent by ${channelName(channel)} to ${maskDestination(channel, destinations[channel])}. Only the latest code is valid.`)
      }
    } catch (failure) {
      if (isCustomerConflict(failure)) showCustomerConflict()
      else if (failure.status === 429 || /try again|too many|rate limit/i.test(failure.message || '')) {
        const delay = retryDelayMs(failure)
        setRetryUntil((current) => ({ ...current, [channel]: Date.now() + delay }))
        setError(`Too many ${channelName(channel)} code requests. Try again after the cooldown shown below.`)
      } else setError(failure.message)
    }
    finally { setBusy(false) }
  }
  const confirmCode = async (channel) => {
    if (hasInvalidContact) { setError(`Correct or clear the invalid ${invalidContacts.join(', ')} before verifying any contact.`); return }
    if (channel !== currentChannel) { setError(`Complete ${channelName(currentChannel)} verification first.`); return }
    setBusy(true); setError('')
    try {
      const result = await authApi.verifyCode(verificationIds[channel], verificationCodes[channel], isLoggedIn, checkoutId)
      if (result.checkout_id) setCheckoutId(result.checkout_id)
      setVerificationTokens((current) => ({ ...current, [channel]: result.verification_token }))
      setMessage(`${channelName(channel)} verified${isLoggedIn ? ' and ready to save to your customer account' : ' for this order'}.`)
    } catch (failure) {
      if (isCustomerConflict(failure)) showCustomerConflict()
      else if (failure.status === 429 || /try again|too many|rate limit/i.test(failure.message || '')) {
        const delay = retryDelayMs(failure)
        setVerifyRetryUntil((current) => ({ ...current, [channel]: Date.now() + delay }))
        setError(`Too many attempts. Try this ${channelName(channel)} code again after the cooldown.`)
      } else if (/expired/i.test(failure.message || '')) setError(`${channelName(channel)} code expired. Request a new code; only the latest code will work.`)
      else setError(`The ${channelName(channel)} code was not accepted. Check the latest code and try again.`)
    }
    finally { setBusy(false) }
  }
  const toggleExtra = (channel) => setExtraChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel])
  const resetContactDetails = (event) => {
    event.currentTarget.form?.reset()
    const savedWhatsapp = user?.whatsapp_number || user?.phone || ''
    setEmail(isLoggedIn ? user?.email || '' : ''); setPhone(isLoggedIn ? user?.phone || '' : ''); setWhatsapp(isLoggedIn ? savedWhatsapp : '')
    setSameAsMobile(isLoggedIn ? !user?.whatsapp_number || user?.whatsapp_number === user?.phone : true); setExtraChannels([]); setSelectedChannels([])
    setVerificationIds({}); setVerificationCodes({}); setVerificationTokens({}); setServerVerifiedChannels({}); setRetryUntil({}); setVerifyRetryUntil({}); setOwnershipFingerprint(''); setCheckoutId('')
    setCustomerConflict(false); setError(''); setMessage('')
  }

  useEffect(() => {
    if (![...Object.values(retryUntil), ...Object.values(verifyRetryUntil)].some((until) => until > Date.now())) return undefined
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryUntil, verifyRetryUntil])

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (!STRIPE_PAYMENTS_ENABLED) throw new Error('Online payments are temporarily unavailable.')
      if (!verificationComplete) throw new Error('Complete every selected contact verification before placing the order.')
      if (extraChannels.some((channel) => !destinations[channel] || !verified(channel))) throw new Error('Additional notification channels must be supplied and verified.')
      const ownershipResult = await ensureContactOwnership()
      if (ownershipResult === false) { setBusy(false); return }
      if (ownershipResult === 'DEFER_TO_CHANNEL') {
        setError('Contact ownership checking is temporarily unavailable. Verify a selected contact or sign in before continuing.')
        setBusy(false)
        return
      }
      const storageKey = getPendingOrderStorageKey(user?.id)
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
        const customerContactUpdates = isLoggedIn ? selectedChannels.filter((channel) => verificationTokens[channel] && !accountVerified(channel)) : []
        const details = { shipping_name: data.get('name'), shipping_phone: toE164(phone), shipping_address: data.get('shippingAddress'), contact_email: destinations.EMAIL, contact_phone: destinations.SMS || '', contact_whatsapp: destinations.WHATSAPP || '', payment_method: 'STRIPE', notification_channels: ['EMAIL', ...extraChannels], verification_channels: selectedChannels, notification_verification_tokens: verificationTokens, verification_tokens: verificationTokens, customer_contact_updates: customerContactUpdates, verification_scope: isLoggedIn ? 'CUSTOMER' : 'ORDER_ONLY', ...(checkoutId ? { checkout_id: checkoutId } : {}) }
        const items = cart.map(({ id, productColorId, quantity }) => ({ product_id: id, product_color_id: productColorId, quantity }))
        const order = isLoggedIn ? await orderApi.checkout({ ...details, items }) : await orderApi.guestCheckout(details, items)
        pending = { id: order.id, accessToken: order.order_access_token || '' }
        sessionStorage.setItem(storageKey, JSON.stringify(pending))
      }
      const result = await paymentApi.createStripeCheckout(pending.id, pending.accessToken)
      if (!result.checkout_url) throw new Error('The payment service did not return a checkout URL.')
      setVerificationIds({})
      setVerificationCodes({})
      setVerificationTokens({})
      window.location.assign(validatedStripeCheckoutUrl(result.checkout_url))
    } catch (failure) { setError(failure.message || 'Checkout could not be started.'); setBusy(false) }
  }

  useEffect(() => {
    if (!confirmed) return
    const sessionId = consumeStripeSessionId()
    let saved
    try { saved = JSON.parse(sessionStorage.getItem(getPendingOrderStorageKey(user?.id))) } catch { saved = null }
    const pending = confirmationReference || saved
    const request = sessionId ? paymentApi.checkoutResult(sessionId, pending?.accessToken) : pending?.id ? paymentApi.orderResult(pending.id, pending.accessToken) : Promise.reject(new Error('Order reference is unavailable.'))
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
    <form onSubmit={submit}><h2>Contact and delivery details</h2><div className="field-grid"><label>Full name<input required name="name" defaultValue={isLoggedIn ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim() : ''}/></label><label>Email address *<input required type="email" value={email} readOnly={isLoggedIn && verified('EMAIL')} aria-invalid={!isValidEmail(email)} onChange={(event) => { setEmail(event.target.value); clearProof('EMAIL') }}/></label><label>SMS phone (optional)<input type="tel" value={phone} readOnly={isLoggedIn && verified('SMS')} aria-invalid={!isValidPhone(phone)} onChange={(event) => updatePhone(event.target.value)} placeholder="+6591234567"/></label>{WHATSAPP_ENABLED && <><label className="checkbox"><input type="checkbox" checked={sameAsMobile} disabled={isLoggedIn && verified('WHATSAPP')} onChange={(event) => toggleSame(event.target.checked)}/> WhatsApp same as mobile</label><label>WhatsApp (optional)<input type="tel" value={whatsapp} disabled={sameAsMobile} readOnly={isLoggedIn && verified('WHATSAPP')} aria-invalid={!isValidPhone(whatsapp)} onChange={(event) => updateWhatsapp(event.target.value)} placeholder="+6591234567"/></label></>}<label className="wide">Shipping address<textarea required name="shippingAddress"/></label></div>
      <section className="notification-confirmation"><h2>Verify supplied contacts</h2><p className="verification-note">Choose the contacts to verify. Codes are sent one at a time in email, SMS, then WhatsApp order.</p>{hasInvalidContact && !customerConflict && <p className="payment-error" role="alert">Correct or clear the invalid {invalidContacts.join(', ')} before verifying a contact.</p>}{customerConflict && <div role="alert"><p className="payment-error">Customer details are already present. Reset the unverified values or sign in with the customer credentials.</p><div className="verification-conflict-actions"><button className="secondary" type="button" onClick={resetContactDetails}>{isLoggedIn ? 'Reset unverified values' : 'Reset all values'}</button>{onSignIn && !isLoggedIn && <button className="secondary" type="button" onClick={onSignIn}>Customer sign in</button>}</div></div>}{suppliedChannels.map((channel) => {
        const isVerified = verified(channel)
        const isSelected = selectedChannels.includes(channel)
        const isCurrent = currentChannel === channel
        const cooldown = Math.max(0, Math.ceil(((retryUntil[channel] || 0) - clock) / 1000))
        const verifyCooldown = Math.max(0, Math.ceil(((verifyRetryUntil[channel] || 0) - clock) / 1000))
        return <div className={`checkout-verification-row ${isCurrent ? 'current' : ''}`} key={channel}><div className="verification-contact"><strong>{channelName(channel)}</strong><span>{maskDestination(channel, destinations[channel])}</span>{accountVerified(channel) ? <small>Already verified</small> : isVerified ? <small>{isLoggedIn ? 'Verified — will be saved to your account' : 'Verified for this order'}</small> : <label className="checkbox"><input type="checkbox" checked={isSelected} disabled={busy || customerConflict} onChange={(event) => toggleVerification(channel, event.target.checked)}/> Verify this contact</label>}</div>{isSelected && !isVerified && <div className="verification-action"><button className="secondary" type="button" disabled={busy || hasInvalidContact || customerConflict || !isCurrent || cooldown > 0} onClick={() => requestCode(channel)}>{cooldown > 0 ? `Try again in ${cooldown}s` : verificationIds[channel] ? `Resend ${channelName(channel)} code` : `Send ${channelName(channel)} code`}</button>{!isCurrent && <small>Complete the previous selected contact first.</small>}{isCurrent && verificationIds[channel] && <div className="verification-code-entry"><label>{channelName(channel)} code for {maskDestination(channel, destinations[channel])}<input aria-label={`${channel} code for ${maskDestination(channel, destinations[channel])}`} inputMode="numeric" maxLength="6" value={verificationCodes[channel] || ''} onChange={(event) => setVerificationCodes((current) => ({ ...current, [channel]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}/></label><button className="secondary" type="button" disabled={busy || verifyCooldown > 0 || (verificationCodes[channel] || '').length !== 6} onClick={() => confirmCode(channel)}>{verifyCooldown > 0 ? `Verify in ${verifyCooldown}s` : `Verify ${channelName(channel)}`}</button></div>}</div>}</div>
      })}</section>
      <section className="notification-confirmation"><h2>Order notifications</h2><label className="checkbox"><input type="checkbox" checked readOnly/> Email (required)</label><label className="checkbox"><input type="checkbox" checked={extraChannels.includes('SMS')} disabled={!destinations.SMS || !verified('SMS')} onChange={() => toggleExtra('SMS')}/> Add SMS</label>{WHATSAPP_ENABLED && <label className="checkbox"><input type="checkbox" checked={extraChannels.includes('WHATSAPP')} disabled={!destinations.WHATSAPP || !verified('WHATSAPP')} onChange={() => toggleExtra('WHATSAPP')}/> Add WhatsApp</label>}</section>
      {message && <p className="verification-note">{message}</p>}{error && <p className="payment-error">{error}</p>}<button className="primary full" disabled={!STRIPE_PAYMENTS_ENABLED || busy || !cart.length || !verificationComplete}>{busy ? 'Please wait…' : `Reserve items & pay S$${orderTotal.toFixed(2)}`}</button>
    </form></section><Summary cart={cart} total={total}/></div></main>
}
