import { useMemo, useState } from 'react'
import './App.css'
import { authApi } from './api'

const products = [
  { id: 12, name: 'Mitti Serving Bowl', craft: 'Blue pottery · Jaipur', price: 79, stock: 8, tone: 'blue', image: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=800&q=85' },
  { id: 18, name: 'Kora Table Runner', craft: 'Handloom cotton · Kerala', price: 54, stock: 12, tone: 'sand', image: 'https://images.unsplash.com/photo-1604014237800-1c9102c219da?auto=format&fit=crop&w=800&q=85' },
  { id: 25, name: 'Aaranya Cane Lamp', craft: 'Handwoven cane · Assam', price: 128, stock: 4, tone: 'amber', image: 'https://images.unsplash.com/photo-1540932239986-30128078f3c5?auto=format&fit=crop&w=800&q=85' },
  { id: 31, name: 'Terra Chai Set', craft: 'Studio pottery · Auroville', price: 92, stock: 6, tone: 'clay', image: 'https://images.unsplash.com/photo-1611566041950-dca3c0a1d50c?auto=format&fit=crop&w=800&q=85' },
  { id: 42, name: 'Neel Blockprint Throw', craft: 'Bagru print · Rajasthan', price: 116, stock: 7, tone: 'indigo', image: 'https://images.unsplash.com/photo-1583845112203-29329902332e?auto=format&fit=crop&w=800&q=85' },
  { id: 49, name: 'Kansa Ritual Tray', craft: 'Bell metal · Odisha', price: 68, stock: 9, tone: 'gold', image: 'https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=85' },
]

const Icon = ({ name, size = 20 }) => {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bag: <><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.6-7.5a5.5 5.5 0 0 0 1.2-8.9Z"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    minus: <path d="M5 12h14"/>, plus: <><path d="M5 12h14M12 5v14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [view, setView] = useState('shop')
  const [cartOpen, setCartOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('authUser')) }
    catch { return null }
  })
  const isLoggedIn = Boolean(user)
  const [cart, setCart] = useState([{ ...products[0], quantity: 1 }, { ...products[1], quantity: 1 }])
  const [checkoutMode, setCheckoutMode] = useState('guest')
  const [confirmed, setConfirmed] = useState(false)
  const [toast, setToast] = useState('')

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)

  const addToCart = (product) => {
    setCart((current) => current.some((item) => item.id === product.id)
      ? current.map((item) => item.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, item.stock) } : item)
      : [...current, { ...product, quantity: 1 }])
    setToast(`${product.name} added to your bag`)
    window.setTimeout(() => setToast(''), 2200)
  }

  const updateQuantity = (id, delta) => setCart((current) => current
    .map((item) => item.id === id ? { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + delta)) } : item)
    .filter((item) => item.quantity > 0))

  const go = (next) => { setView(next); setCartOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const login = (session) => {
    localStorage.setItem('authToken', session.token)
    localStorage.setItem('authUser', JSON.stringify(session.user))
    setUser(session.user)
    setCheckoutMode('customer')
    setLoginOpen(false)
    setToast(`Welcome back, ${session.user.first_name}`)
  }
  const logout = () => {
    localStorage.removeItem('authToken')
    localStorage.removeItem('authUser')
    setUser(null)
    setCheckoutMode('guest')
    if (view === 'orders') go('shop')
    setToast('You have been signed out')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Open menu"><Icon name="menu" /></button>
        <button className="brand" onClick={() => go('shop')}><span>shilp</span><i>&</i><span>soul</span></button>
        <nav aria-label="Main navigation">
          <button className={view === 'shop' ? 'active' : ''} onClick={() => go('shop')}>Shop</button>
          <button onClick={() => go('shop')}>New arrivals</button>
          <button onClick={() => go('track')}>Track order</button>
          {isLoggedIn && <button onClick={() => go('orders')}>My orders</button>}
        </nav>
        <div className="header-actions">
          <button className="icon-button search-button" aria-label="Search"><Icon name="search" /></button>
          <button className="account-button" onClick={() => isLoggedIn ? go('orders') : setLoginOpen(true)}><Icon name="user"/><span>{isLoggedIn ? `Hi, ${user.first_name}` : 'Sign in'}</span></button>
          {isLoggedIn && <button className="logout-button" onClick={logout}>Log out</button>}
          <button className="icon-button bag-button" onClick={() => setCartOpen(true)} aria-label={`Shopping bag with ${count} items`}><Icon name="bag"/><b>{count}</b></button>
        </div>
      </header>

      {view === 'shop' && <Shop products={products} addToCart={addToCart} />}
      {view === 'checkout' && <Checkout cart={cart} total={total} mode={checkoutMode} setMode={setCheckoutMode} isLoggedIn={isLoggedIn} onLogin={() => setLoginOpen(true)} onConfirm={() => setConfirmed(true)} confirmed={confirmed} go={go} />}
      {view === 'track' && <TrackOrder />}
      {view === 'orders' && <Orders />}

      <footer>
        <div className="footer-brand"><div className="brand light"><span>shilp</span><i>&</i><span>soul</span></div><p>Objects with a story. Made slowly,<br/>chosen thoughtfully.</p></div>
        <div><h4>Explore</h4><a>Our story</a><a>Artisans</a><a>Journal</a></div>
        <div><h4>Help</h4><a>Shipping & returns</a><button onClick={() => go('track')}>Track an order</button><a>Contact us</a></div>
        <div className="newsletter"><h4>Notes from the studio</h4><p>New collections, craft stories, and quiet inspiration.</p><label><span className="sr-only">Email address</span><input type="email" placeholder="Your email address"/><button aria-label="Subscribe"><Icon name="arrow"/></button></label></div>
      </footer>

      {cartOpen && <><div className="scrim" onClick={() => setCartOpen(false)}/><CartDrawer cart={cart} total={total} updateQuantity={updateQuantity} close={() => setCartOpen(false)} checkout={() => go('checkout')} /></>}
      {loginOpen && <><div className="scrim" onClick={() => setLoginOpen(false)}/><Login close={() => setLoginOpen(false)} success={login} /></>}
      {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}
    </div>
  )
}

function Shop({ products, addToCart }) {
  return <main>
    <section className="hero-section">
      <div className="hero-copy"><span className="eyebrow">Handmade for the everyday</span><h1>Live with things<br/><em>that have a soul.</em></h1><p>Thoughtful objects, made by hand across India. Each piece carries the mark of its maker.</p><button className="primary">Explore the collection <Icon name="arrow" size={18}/></button></div>
      <div className="hero-art"><div className="hero-image"></div><div className="maker-note"><span>Meet the maker</span><strong>Meera & her blue pottery studio</strong><button aria-label="Read story"><Icon name="arrow" size={17}/></button></div><span className="shape shape-one"></span><span className="shape shape-two"></span></div>
    </section>
    <section className="story-strip"><p><span>01</span> Small-batch</p><p><span>02</span> Artisan-made</p><p><span>03</span> Responsibly sourced</p><p><span>04</span> Made to last</p></section>
    <section className="collection">
      <div className="section-head"><div><span className="eyebrow">Curated for you</span><h2>Objects of quiet beauty</h2></div><button>View all pieces <Icon name="arrow" size={17}/></button></div>
      <div className="filters"><button className="selected">All objects</button><button>Table & kitchen</button><button>Textiles</button><button>Lighting</button><button>Decor</button></div>
      <div className="product-grid">{products.map((p, i) => <article className="product-card" key={p.id}>
        <div className={`product-image ${p.tone}`}><img src={p.image} alt={p.name}/>{i < 2 && <span className="new-tag">New</span>}<button className="wish" aria-label={`Save ${p.name}`}><Icon name="heart" size={18}/></button><button className="quick-add" onClick={() => addToCart(p)}>Quick add <Icon name="plus" size={16}/></button></div>
        <div className="product-meta"><div><h3>{p.name}</h3><p>{p.craft}</p></div><strong>S${p.price}</strong></div>
      </article>)}</div>
    </section>
    <section className="craft-callout"><div className="craft-image"></div><div><span className="eyebrow">The hands behind the work</span><h2>Craft is a conversation<br/>across generations.</h2><p>We work directly with independent makers and family workshops, honouring techniques that have been refined over centuries.</p><button className="text-link">Meet our makers <Icon name="arrow" size={18}/></button></div></section>
  </main>
}

function CartDrawer({ cart, total, updateQuantity, close, checkout }) {
  return <aside className="cart-drawer" aria-label="Shopping bag"><div className="drawer-head"><div><span className="eyebrow">Your selection</span><h2>Shopping bag <small>{cart.length}</small></h2></div><button className="icon-button" onClick={close} aria-label="Close bag"><Icon name="close"/></button></div>
    <div className="cart-items">{cart.length === 0 ? <div className="empty"><Icon name="bag" size={35}/><h3>Your bag is empty</h3><p>Beautiful things are waiting.</p></div> : cart.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt=""/><div className="cart-info"><h3>{item.name}</h3><p>{item.craft}</p><div className="quantity"><button onClick={() => updateQuantity(item.id, -1)} aria-label="Decrease quantity"><Icon name="minus" size={14}/></button><span>{item.quantity}</span><button onClick={() => updateQuantity(item.id, 1)} aria-label="Increase quantity"><Icon name="plus" size={14}/></button></div></div><strong>S${item.price * item.quantity}</strong></div>)}</div>
    <div className="drawer-bottom"><p className="delivery-note"><Icon name="check" size={15}/> Complimentary delivery over S$150</p><div className="subtotal"><span>Subtotal</span><strong>S${total.toFixed(2)}</strong></div><small>Taxes included. Shipping calculated at checkout.</small><button className="primary full" disabled={!cart.length} onClick={checkout}>Continue to checkout <Icon name="arrow" size={18}/></button><button className="continue" onClick={close}>Continue shopping</button></div>
  </aside>
}

function Checkout({ cart, total, mode, setMode, isLoggedIn, onLogin, onConfirm, confirmed, go }) {
  if (confirmed) return <main className="confirmation"><div className="success-mark"><Icon name="check" size={30}/></div><span className="eyebrow">Order confirmed</span><h1>Thank you for choosing<br/><em>handmade.</em></h1><p>Your order has been received. We’ll send the details and delivery updates to your email.</p><div className="order-number"><span>Order number</span><strong>SNS-20260801-0001</strong><button>Copy</button></div><div className="confirmation-actions"><button className="primary" onClick={() => go('shop')}>Continue shopping</button><button className="secondary" onClick={() => go('track')}>Track this order</button></div></main>
  return <main className="checkout-page"><div className="checkout-heading"><button className="back" onClick={() => go('shop')}>← Back to shop</button><span className="eyebrow">A simple final step</span><h1>Checkout</h1><p>No account needed. Choose how you’d like to continue.</p></div>
    <div className="checkout-layout"><section className="checkout-form"><div className="mode-tabs"><button className={mode === 'guest' ? 'active' : ''} onClick={() => setMode('guest')}><span>Guest checkout</span><small>Quick, no account needed</small></button><button className={mode === 'customer' ? 'active' : ''} onClick={() => isLoggedIn ? setMode('customer') : onLogin()}><span>{isLoggedIn ? 'Asha Sharma' : 'Customer sign in'}</span><small>{isLoggedIn ? 'Checkout with saved details' : 'Access saved details & orders'}</small></button></div>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm() }}><h2>{mode === 'guest' ? 'Where should we send it?' : 'Confirm your delivery details'}</h2><div className="field-grid"><label>Full name<input required defaultValue={isLoggedIn && mode === 'customer' ? 'Asha Sharma' : ''} placeholder="Your full name"/></label><label>Email address<input required type="email" defaultValue={isLoggedIn && mode === 'customer' ? 'asha@example.com' : ''} placeholder="you@example.com"/></label><label>Phone number<input required type="tel" defaultValue={isLoggedIn && mode === 'customer' ? '+65 8123 4567' : ''} placeholder="+65 0000 0000"/></label><label className="wide">Shipping address<textarea required defaultValue={isLoggedIn && mode === 'customer' ? '91 West Coast Vale, Singapore 126755' : ''} placeholder="Street, unit number, postal code"/></label></div><label className="checkbox"><input type="checkbox"/> Send me occasional notes from the studio</label><button className="primary full" disabled={!cart.length}>Place order · S${total.toFixed(2)} <Icon name="arrow" size={18}/></button><p className="secure">By placing your order, you agree to our terms. No payment is collected online.</p></form>
    </section><OrderSummary cart={cart} total={total}/></div>
  </main>
}

function OrderSummary({ cart, total }) { return <aside className="order-summary"><div className="summary-head"><h2>Your order</h2><span>{cart.length} items</span></div>{cart.map(item => <div className="summary-item" key={item.id}><div><img src={item.image} alt=""/><b>{item.quantity}</b></div><p><strong>{item.name}</strong><span>{item.craft}</span></p><em>S${(item.price * item.quantity).toFixed(2)}</em></div>)}<div className="summary-lines"><p><span>Subtotal</span><b>S${total.toFixed(2)}</b></p><p><span>Delivery</span><b>{total >= 150 ? 'Complimentary' : 'S$8.00'}</b></p></div><div className="summary-total"><span>Total <small>SGD</small></span><strong>S${(total + (total >= 150 ? 0 : 8)).toFixed(2)}</strong></div></aside> }

function Login({ close, success }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const data = new FormData(event.currentTarget)
    try { success(await authApi.login(data.get('email'), data.get('password'))) }
    catch (loginError) { setError(loginError.message) }
    finally { setSubmitting(false) }
  }
  return <section className="login-modal"><div className="login-visual"><button className="brand light"><span>shilp</span><i>&</i><span>soul</span></button><div><span className="eyebrow">Welcome home</span><blockquote>“Beautiful things are<br/>made to be lived with.”</blockquote><p>Sign in to revisit your orders and saved details.</p></div><small>Crafted with care · Singapore</small></div><div className="login-form"><button className="icon-button login-close" onClick={close} aria-label="Close"><Icon name="close"/></button><span className="eyebrow">Customer account</span><h2>Welcome back</h2><p>Enter your details to continue.</p><form onSubmit={submit}><label>Email address<input required name="email" type="email" autoComplete="email" placeholder="you@example.com"/></label><label><span>Password <button type="button">Forgot password?</button></span><input required name="password" type="password" autoComplete="current-password" placeholder="••••••••"/></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} {!submitting && <Icon name="arrow" size={18}/>}</button></form><div className="or"><span>or</span></div><p className="signup">New to Shilp & Soul? <button>Create an account</button></p><button className="guest-link" onClick={close}>Continue shopping as guest</button></div></section>
}

function TrackOrder() { const [found, setFound] = useState(false); return <main className="utility-page"><div className="utility-card"><span className="eyebrow">Guest order tracking</span><h1>Where is my order?</h1><p>Enter your order number and the email or phone used at checkout.</p><form onSubmit={(e) => { e.preventDefault(); setFound(true) }}><label>Order number<input required placeholder="SNS-20260801-0001" defaultValue="SNS-20260801-0001"/></label><label>Email or phone<input required placeholder="you@example.com" defaultValue="guest@example.com"/></label><button className="primary full">Track order <Icon name="arrow" size={18}/></button></form>{found && <div className="tracking-result"><div><span>Order status</span><strong>Preparing your pieces</strong></div><div className="progress"><i></i></div><div className="steps"><b>Confirmed</b><b>Preparing</b><span>Dispatched</span><span>Delivered</span></div><p>Estimated dispatch in 1–2 working days.</p></div>}</div></main> }

function Orders() { return <main className="orders-page"><span className="eyebrow">Your collection</span><h1>My orders</h1><p>Keep track of the beautiful things you’ve chosen.</p><article className="order-card"><div className="order-card-head"><div><span>Order SNS-20260718-0042</span><small>Placed 18 July 2026</small></div><b>Delivered</b></div><div className="order-card-body"><div className="order-thumbs"><img src={products[2].image} alt=""/><img src={products[4].image} alt=""/></div><div><span>2 items</span><strong>S$244.00</strong></div><button className="secondary">View details <Icon name="chevron" size={16}/></button></div></article></main> }

export default App
