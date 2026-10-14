import { useEffect, useMemo, useState } from 'react'
import { authApi } from './api'

const WHATSAPP_ENABLED = import.meta.env.VITE_WHATSAPP_ENABLED === 'true'

const toE164 = (value, defaultCountryCode = '65') => {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  if (raw.startsWith('00')) return `+${digits.slice(2)}`
  return digits.length === 8 ? `+${defaultCountryCode}${digits}` : `+${digits}`
}

const channelName = (channel) => channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'SMS' ? 'SMS' : 'email'

function VerificationRows({ channels, destinations, purpose, invitationToken = '', tokens, setTokens, disabled, setDisabled, setMessage, setError }) {
  const [ids, setIds] = useState({})
  const [codes, setCodes] = useState({})
  const requestCode = async (channel) => {
    setDisabled(true); setError(''); setMessage('')
    try {
      const result = await authApi.requestVerification(destinations[channel], purpose, channel, invitationToken)
      setIds((current) => ({ ...current, [channel]: result.verification_id }))
      setMessage(`A six-digit code was sent by ${channelName(channel)}.`)
    } catch (error) { setError(error.message) }
    finally { setDisabled(false) }
  }
  const confirmCode = async (channel) => {
    setDisabled(true); setError('')
    try {
      const result = await authApi.verifyCode(ids[channel], codes[channel], false)
      setTokens((current) => ({ ...current, [channel]: result.verification_token }))
      setMessage(`${channelName(channel)} verified.`)
    } catch (error) { setError(error.message) }
    finally { setDisabled(false) }
  }
  return <div className="registration-verification-list">
    {channels.map((channel) => <div className="registration-verification" key={channel}>
      <button className="secondary" type="button" disabled={disabled || tokens[channel]} onClick={() => requestCode(channel)}>{tokens[channel] ? `${channelName(channel)} verified` : ids[channel] ? 'Resend code' : `Send ${channelName(channel)} code`}</button>
      {ids[channel] && !tokens[channel] && <>
        <input aria-label={`${channel} six-digit verification code`} inputMode="numeric" maxLength="6" value={codes[channel] || ''} onChange={(event) => setCodes((current) => ({ ...current, [channel]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}/>
        <button className="secondary" type="button" disabled={disabled || (codes[channel] || '').length !== 6} onClick={() => confirmCode(channel)}>Verify</button>
      </>}
    </div>)}
  </div>
}

function InvitationSetup({ token, close, success }) {
  const [invitation, setInvitation] = useState(null)
  const [tokens, setTokens] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { authApi.invitation(token).then(setInvitation).catch((failure) => setError(failure.message)) }, [token])
  const destinations = useMemo(() => invitation ? { ...(invitation.phone ? { SMS: invitation.phone } : {}), ...(invitation.whatsapp_number ? { WHATSAPP: invitation.whatsapp_number } : {}) } : {}, [invitation])
  const channels = Object.keys(destinations)
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (channels.some((channel) => !tokens[channel])) throw new Error('Verify every contact included in the invitation.')
      const result = await authApi.acceptInvitation({ invitation_token: token, password: data.get('password'), verification_tokens: tokens })
      if (result.token) success(result)
      else { setMessage('Account setup complete. You can now sign in through the appropriate portal.'); window.setTimeout(close, 1800) }
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="login-modal"><div className="login-form"><button type="button" className="icon-button login-close" onClick={close} aria-label="Close">×</button><span className="eyebrow">Account invitation</span><h2>Complete account setup</h2>
    {!invitation && !error && <p>Loading invitation…</p>}
    {invitation && <form className="login-form" onSubmit={submit}><p>{invitation.email}</p>
      {channels.length > 0 && <><p>Verify the contacts supplied by the administrator.</p><VerificationRows channels={channels} destinations={destinations} purpose="INVITATION" invitationToken={token} tokens={tokens} setTokens={setTokens} disabled={busy} setDisabled={setBusy} setMessage={setMessage} setError={setError}/></>}
      <label>New password<input required name="password" type="password" minLength="12" autoComplete="new-password"/></label>
      <button className="primary full" disabled={busy || channels.some((channel) => !tokens[channel])}>{busy ? 'Please wait…' : 'Activate account'}</button>
    </form>}
    {message && <p className="verification-success" role="status">{message}</p>}{error && <p className="login-error" role="alert">{error}</p>}
  </div></section>
}

export default function AccountAccess({ close, success, continueAsGuest }) {
  const [invitationToken] = useState(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('invitation') || ''
    if (token) {
      url.searchParams.delete('invitation')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
    return token
  })
  return invitationToken
    ? <InvitationSetup token={invitationToken} close={close} success={success}/>
    : <StandardAccountAccess close={close} success={success} continueAsGuest={continueAsGuest}/>
}

function StandardAccountAccess({ close, success, continueAsGuest }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [sameAsMobile, setSameAsMobile] = useState(true)
  const [tokens, setTokens] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const destinations = { EMAIL: email.trim().toLowerCase(), ...(toE164(phone) ? { SMS: toE164(phone) } : {}), ...(WHATSAPP_ENABLED && toE164(whatsapp) ? { WHATSAPP: toE164(whatsapp) } : {}) }
  const channels = Object.keys(destinations).filter((channel) => destinations[channel])
  const updateEmail = (value) => { setEmail(value); setTokens((current) => ({ ...current, EMAIL: undefined })) }
  const updatePhone = (value) => {
    setPhone(value); setTokens((current) => ({ ...current, SMS: undefined, ...(sameAsMobile ? { WHATSAPP: undefined } : {}) }))
    if (sameAsMobile) setWhatsapp(value)
  }
  const toggleSame = (checked) => { setSameAsMobile(checked); if (checked) { setWhatsapp(phone); setTokens((current) => ({ ...current, WHATSAPP: undefined })) } }

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const data = new FormData(event.currentTarget)
    try {
      if (mode === 'register') {
        if (channels.some((channel) => !tokens[channel])) throw new Error('Verify every supplied contact before creating the account.')
        success(await authApi.register({ first_name: data.get('firstName'), last_name: data.get('lastName'), email: destinations.EMAIL, country_code: '+65', phone: phone.trim(), whatsapp_number: whatsapp.trim(), password: data.get('password'), preferred_notification_channel: 'EMAIL', verification_tokens: tokens }))
      } else if (mode === 'reset') {
        await authApi.confirmPasswordReset(email.trim().toLowerCase(), data.get('code'), data.get('password'))
        setMessage('Password updated. Sign in with your new password.'); setMode('login')
      } else success(await authApi.login(data.get('email'), data.get('password')))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const requestReset = async () => { setBusy(true); setError(''); try { const result = await authApi.requestPasswordReset(email.trim().toLowerCase()); setMessage(result.message) } catch (failure) { setError(failure.message) } finally { setBusy(false) } }

  return <section className="login-modal"><div className="login-visual"><div><span className="eyebrow">Welcome home</span><blockquote>Beautiful things are<br/>made to be lived with.</blockquote></div><small>Crafted with care · Singapore</small></div><div className="login-form"><button type="button" className="icon-button login-close" onClick={close} aria-label="Close">×</button><span className="eyebrow">Customer account</span><h2>{mode === 'register' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h2>
    <form onSubmit={submit}>
      {mode === 'register' && <div className="registration-names"><label>First name<input required name="firstName" autoComplete="given-name"/></label><label>Last name<input required name="lastName" autoComplete="family-name"/></label></div>}
      <label>Email address<input required name="email" type="email" autoComplete="email" value={mode === 'login' ? undefined : email} onChange={mode === 'login' ? undefined : (event) => updateEmail(event.target.value)}/></label>
      {mode === 'register' && <><label>SMS phone (optional)<input name="phone" type="tel" value={phone} onChange={(event) => updatePhone(event.target.value)} placeholder="+6591234567"/></label>{WHATSAPP_ENABLED && <><label className="checkbox"><input type="checkbox" checked={sameAsMobile} onChange={(event) => toggleSame(event.target.checked)}/> WhatsApp same as mobile</label><label>WhatsApp (optional)<input name="whatsapp" type="tel" value={whatsapp} disabled={sameAsMobile} onChange={(event) => { setWhatsapp(event.target.value); setTokens((current) => ({ ...current, WHATSAPP: undefined })) }} placeholder="+6591234567"/></label></>}
        <VerificationRows channels={channels} destinations={destinations} purpose="REGISTRATION" tokens={tokens} setTokens={setTokens} disabled={busy} setDisabled={setBusy} setMessage={setMessage} setError={setError}/></>}
      {mode === 'reset' && <><button className="secondary" type="button" disabled={busy || !email.trim()} onClick={requestReset}>Send email code</button><label>Six-digit code<input required name="code" inputMode="numeric" maxLength="6"/></label></>}
      <label>{mode === 'reset' ? 'New password' : 'Password'}<input required name="password" type="password" minLength={mode === 'login' ? undefined : 12} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>
      {error && <p className="login-error" role="alert">{error}</p>}{message && <p className="verification-note" role="status">{message}</p>}
      <button className="primary full" disabled={busy || (mode === 'register' && channels.some((channel) => !tokens[channel]))}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Set new password' : 'Sign in'}</button>
    </form>
    {mode === 'login' && <button className="guest-link" type="button" onClick={() => { setMode('reset'); setError(''); setMessage('') }}>Forgot password?</button>}
    <p className="signup">{mode === 'register' ? 'Already have an account?' : 'New to Shilp & Soul?'} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); setMessage('') }}>{mode === 'register' ? 'Sign in' : 'Create an account'}</button></p>
    {continueAsGuest && <button className="guest-link" onClick={continueAsGuest}>Continue as guest</button>}
  </div></section>
}
