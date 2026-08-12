import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { authApi, catalogApi, orderApi, paymentApi } from './api'

const FALLBACK_IMAGE = '/product-placeholder.svg'
const LIVE_MODE = import.meta.env.VITE_LIVE_MODE === 'true'
const userCartKey = (userId) => `shoppingCart:user:${userId}`
const pendingStripeOrderKey = (userId) => `pendingStripeOrder:${userId}`
const paymentReturn = () => window.location.pathname.replace(/\/$/, '')
const initialView = () => ['/payment/cancel', '/payment/success'].includes(paymentReturn()) ? 'checkout' : 'shop'

const savedUserCart = (userId) => {
  if (!userId) return []
  try {
    const saved = JSON.parse(localStorage.getItem(userCartKey(userId)))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

const productImages = (product) => {
  if (Array.isArray(product.images)) return product.images.filter((url) => /^https?:\/\//i.test(String(url)))
  if (!product.image_url) return []
  try {
    const parsed = JSON.parse(product.image_url)
    if (Array.isArray(parsed)) return parsed.filter((url) => /^https?:\/\//i.test(String(url)))
  } catch {
    // Legacy records store one URL directly rather than a JSON array.
  }
  return /^https?:\/\//i.test(String(product.image_url)) ? [product.image_url] : []
}

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
  const [view, setView] = useState(initialView)
  const [cartOpen, setCartOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('authUser')) }
    catch { return null }
  })
  const isLoggedIn = Boolean(user)
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [cart, setCart] = useState(() => savedUserCart(user?.id))
  const [checkoutMode, setCheckoutMode] = useState(() => user || !LIVE_MODE ? 'customer' : 'guest')
  const [confirmed, setConfirmed] = useState(() => paymentReturn() === '/payment/success')
  const [toast, setToast] = useState(() => paymentReturn() === '/payment/cancel' ? 'Payment cancelled. Your bag has been kept.' : '')

  useEffect(() => {
    const routePaymentReturn = () => {
      const path = paymentReturn()
      if (path === '/payment/cancel') {
        setConfirmed(false)
        setView('checkout')
        setToast('Payment cancelled. Your bag has been kept.')
      } else if (path === '/payment/success') {
        setConfirmed(true)
        setView('checkout')
        setCart([])
        if (user?.id) {
          localStorage.removeItem(userCartKey(user.id))
          localStorage.removeItem(pendingStripeOrderKey(user.id))
        }
      }
    }
    routePaymentReturn()
    window.addEventListener('popstate', routePaymentReturn)
    return () => window.removeEventListener('popstate', routePaymentReturn)
  }, [user])

  useEffect(() => {
    let active = true
    const loadCatalog = async () => {
      try {
        const [productRecords, categoryRecords] = await Promise.all([
          catalogApi.products(),
          catalogApi.categories(),
        ])
        if (!active) return
        const activeCategories = categoryRecords.filter((category) => category.is_active !== false)
        const categoryNames = new Map(activeCategories.map((category) => [String(category.id), category.name]))
        setCategories(activeCategories)
        setProducts(productRecords
          .filter((product) => product.is_active !== false)
          .map((product) => {
            const images = productImages(product)
            return {
              ...product,
              images,
              price: Number(product.price),
              stock: Number(product.stock_quantity),
              image: images[0] || FALLBACK_IMAGE,
              craft: categoryNames.get(String(product.category_id)) || 'Uncategorised',
            }
          }))
      } catch (error) {
        if (active) setCatalogError(error.message || 'Unable to load the collection')
      } finally {
        if (active) setCatalogLoading(false)
      }
    }
    loadCatalog()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (user?.id) localStorage.setItem(userCartKey(user.id), JSON.stringify(cart))
  }, [cart, user])

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

  const go = (next) => {
    setView(next)
    setCartOpen(false)
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const login = (session) => {
    localStorage.setItem('authToken', session.token)
    localStorage.setItem('authUser', JSON.stringify(session.user))
    setCart(savedUserCart(session.user.id))
    setUser(session.user)
    setCheckoutMode('customer')
    setLoginOpen(false)
    setToast(`Welcome back, ${session.user.first_name}`)
  }
  const logout = () => {
    if (user?.id) localStorage.setItem(userCartKey(user.id), JSON.stringify(cart))
    localStorage.removeItem('authToken')
    localStorage.removeItem('authUser')
    setUser(null)
    setCart([])
    setConfirmed(false)
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

      {view === 'shop' && <Shop products={products} categories={categories} loading={catalogLoading} error={catalogError} cart={cart} addToCart={addToCart} />}
      {view === 'checkout' && <Checkout cart={cart} total={total} mode={checkoutMode} setMode={setCheckoutMode} user={user} isLoggedIn={isLoggedIn} onConfirm={() => setConfirmed(true)} confirmed={confirmed} go={go} />}
      {view === 'track' && <TrackOrder />}
      {view === 'orders' && <Orders />}

      <footer>
        <div className="footer-brand"><div className="brand light"><span>shilp</span><i>&</i><span>soul</span></div><p>Objects with a story. Made slowly,<br/>chosen thoughtfully.</p></div>
        <div><h4>Explore</h4><a>Our story</a><a>Artisans</a><a>Journal</a></div>
        <div><h4>Help</h4><a>Shipping & returns</a><button onClick={() => go('track')}>Track an order</button><a>Contact us</a></div>
        <div className="newsletter"><h4>Notes from the studio</h4><p>New collections, craft stories, and quiet inspiration.</p><label><span className="sr-only">Email address</span><input type="email" placeholder="Your email address"/><button aria-label="Subscribe"><Icon name="arrow"/></button></label></div>
      </footer>

      {cartOpen && <><div className="scrim" onClick={() => setCartOpen(false)}/><CartDrawer cart={cart} total={total} updateQuantity={updateQuantity} close={() => setCartOpen(false)} checkout={() => isLoggedIn ? go('checkout') : (setCartOpen(false), setLoginOpen(true))} /></>}
      {loginOpen && <><div className="scrim" onClick={() => setLoginOpen(false)}/><Login close={() => setLoginOpen(false)} success={login} /></>}
      {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}
    </div>
  )
}

function Shop({ products, categories, loading, error, cart, addToCart }) {
  const [categoryId, setCategoryId] = useState('all')
  const visibleProducts = categoryId === 'all'
    ? products
    : products.filter((product) => String(product.category_id) === categoryId)

  return <main>
    <section className="hero-section">
      <div className="hero-copy"><span className="eyebrow">Handmade for the everyday</span><h1>Live with things<br/><em>that have a soul.</em></h1><p>Thoughtful objects, made by hand across India. Each piece carries the mark of its maker.</p><button className="primary">Explore the collection <Icon name="arrow" size={18}/></button></div>
      <div className="hero-art"><div className="hero-image"></div><div className="maker-note"><span>Meet the maker</span><strong>Meera & her blue pottery studio</strong><button aria-label="Read story"><Icon name="arrow" size={17}/></button></div><span className="shape shape-one"></span><span className="shape shape-two"></span></div>
    </section>
    <section className="story-strip"><p><span>01</span> Small-batch</p><p><span>02</span> Artisan-made</p><p><span>03</span> Responsibly sourced</p><p><span>04</span> Made to last</p></section>
    <section className="collection">
      <div className="section-head"><div><span className="eyebrow">Curated for you</span><h2>Objects of quiet beauty</h2></div><button>View all pieces <Icon name="arrow" size={17}/></button></div>
      <div className="filters" aria-label="Product categories"><button className={categoryId === 'all' ? 'selected' : ''} onClick={() => setCategoryId('all')}>All objects</button>{categories.map((category) => <button className={categoryId === String(category.id) ? 'selected' : ''} onClick={() => setCategoryId(String(category.id))} key={category.id}>{category.name}</button>)}</div>
      {loading && <div className="catalog-status" role="status">Loading the collection…</div>}
      {error && <div className="catalog-status error" role="alert">{error}</div>}
      {!loading && !error && visibleProducts.length === 0 && <div className="catalog-status">No pieces are available in this category yet.</div>}
      <div className="product-grid">{visibleProducts.map((product) => <ProductCard product={product} cartQuantity={cart.find((item) => item.id === product.id)?.quantity || 0} addToCart={addToCart} key={product.id} />)}</div>
    </section>
    <section className="craft-callout"><div className="craft-image"></div><div><span className="eyebrow">The hands behind the work</span><h2>Craft is a conversation<br/>across generations.</h2><p>We work directly with independent makers and family workshops, honouring techniques that have been refined over centuries.</p><button className="text-link">Meet our makers <Icon name="arrow" size={18}/></button></div></section>
  </main>
}

function ProductCard({ product, cartQuantity, addToCart }) {
  const images = product.images.length ? product.images : [FALLBACK_IMAGE]
  const [imageIndex, setImageIndex] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [expandedIndex, setExpandedIndex] = useState(0)

  useEffect(() => {
    if (!previewing || images.length < 2) return undefined
    const timer = window.setInterval(() => {
      setImageIndex((current) => (current + 1) % images.length)
    }, 900)
    return () => window.clearInterval(timer)
  }, [previewing, images.length])

  useEffect(() => {
    if (!expanded) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setExpanded(false)
      if (event.key === 'ArrowRight') setExpandedIndex((current) => (current + 1) % images.length)
      if (event.key === 'ArrowLeft') setExpandedIndex((current) => (current - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expanded, images.length])

  const stopPreview = () => {
    setPreviewing(false)
    setImageIndex(0)
  }

  const openGallery = () => {
    setExpandedIndex(imageIndex)
    setExpanded(true)
  }

  return <article className="product-card" onMouseEnter={() => setPreviewing(true)} onMouseLeave={stopPreview} onFocus={() => setPreviewing(true)} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) stopPreview()
  }}>
    <div className="product-image">
      <button className="zoom-trigger" onClick={openGallery} aria-label={`Enlarge images for ${product.name}`}>
        <img src={images[imageIndex]} alt={`${product.name}${images.length > 1 ? `, view ${imageIndex + 1} of ${images.length}` : ''}`} onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE }} />
      </button>
      {images.length > 1 && <span className="image-count" aria-hidden="true">{imageIndex + 1}/{images.length}</span>}
      <button className="wish" aria-label={`Save ${product.name}`}><Icon name="heart" size={18}/></button>
      <button className="quick-add" disabled={product.stock < 1} onClick={() => addToCart(product)}>{product.stock < 1 ? 'Out of stock' : 'Quick add'} <Icon name="plus" size={16}/></button>
    </div>
    <div className="product-meta"><div><h3>{product.name}</h3><p>{product.craft}</p><p className={`stock-availability ${product.stock < 1 ? 'out-of-stock' : ''}`}><span>{product.stock < 1 ? 'Out of stock' : `${product.stock} available`}</span>{cartQuantity > 0 && <b>{cartQuantity} in bag</b>}</p></div><strong>S${product.price.toFixed(2)}</strong></div>
    {expanded && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`${product.name} image gallery`} onClick={() => setExpanded(false)}>
      <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button className="lightbox-close icon-button" onClick={() => setExpanded(false)} aria-label="Close image gallery"><Icon name="close" /></button>
        <button className="lightbox-main" onClick={() => setExpandedIndex((expandedIndex + 1) % images.length)} aria-label={images.length > 1 ? 'Show next image' : product.name}>
          <img src={images[expandedIndex]} alt={`${product.name}, enlarged view ${expandedIndex + 1} of ${images.length}`} onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE }} />
        </button>
        {images.length > 1 && <>
          <button className="gallery-arrow previous" onClick={() => setExpandedIndex((expandedIndex - 1 + images.length) % images.length)} aria-label="Previous image"><Icon name="chevron" /></button>
          <button className="gallery-arrow next" onClick={() => setExpandedIndex((expandedIndex + 1) % images.length)} aria-label="Next image"><Icon name="chevron" /></button>
        </>}
        <div className="gallery-thumbnails" aria-label="Choose product image">{images.map((url, index) => <button className={expandedIndex === index ? 'selected' : ''} onClick={() => setExpandedIndex(index)} aria-label={`View image ${index + 1}`} key={`${url}-${index}`}><img src={url} alt="" /></button>)}</div>
        <span className="lightbox-count">{expandedIndex + 1} / {images.length}</span>
      </div>
    </div>}
  </article>
}

function CartDrawer({ cart, total, updateQuantity, close, checkout }) {
  return <aside className="cart-drawer" aria-label="Shopping bag"><div className="drawer-head"><div><span className="eyebrow">Your selection</span><h2>Shopping bag <small>{cart.length}</small></h2></div><button className="icon-button" onClick={close} aria-label="Close bag"><Icon name="close"/></button></div>
    <div className="cart-items">{cart.length === 0 ? <div className="empty"><Icon name="bag" size={35}/><h3>Your bag is empty</h3><p>Beautiful things are waiting.</p></div> : cart.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt=""/><div className="cart-info"><h3>{item.name}</h3><p>{item.craft}</p><div className="quantity"><button onClick={() => updateQuantity(item.id, -1)} aria-label="Decrease quantity"><Icon name="minus" size={14}/></button><span>{item.quantity}</span><button onClick={() => updateQuantity(item.id, 1)} aria-label="Increase quantity"><Icon name="plus" size={14}/></button></div></div><strong>S${item.price * item.quantity}</strong></div>)}</div>
    <div className="drawer-bottom"><p className="delivery-note"><Icon name="check" size={15}/> Complimentary delivery over S$150</p><div className="subtotal"><span>Subtotal</span><strong>S${total.toFixed(2)}</strong></div><small>Taxes included. Shipping calculated at checkout.</small><button className="primary full" disabled={!cart.length} onClick={checkout}>Continue to checkout <Icon name="arrow" size={18}/></button><button className="continue" onClick={close}>Continue shopping</button></div>
  </aside>
}

function Checkout({ cart, total, mode, setMode, user, isLoggedIn, onConfirm, confirmed, go }) {
  const delivery = total >= 150 ? 0 : 8
  const orderTotal = total + delivery
  const customerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Customer'
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('stripe')
  const [paymentError, setPaymentError] = useState('')
  const [redirecting, setRedirecting] = useState(false)

  const submitCheckout = async (event) => {
    event.preventDefault()
    if (paymentMethod === 'paynow') return onConfirm()
    setPaymentError('')
    setRedirecting(true)
    const data = new FormData(event.currentTarget)
    try {
      if (!isLoggedIn) throw new Error('Please sign in to pay securely with Stripe.')
      let orderId = localStorage.getItem(pendingStripeOrderKey(user.id))
      if (!orderId) {
        const order = await orderApi.checkout({
          shipping_name: data.get('name'), shipping_phone: data.get('phone'), shipping_address: data.get('shippingAddress'),
          contact_email: data.get('email'), contact_phone: data.get('phone'), payment_method: 'STRIPE',
          items: cart.map(({ id, quantity }) => ({ product_id: id, quantity })),
        })
        orderId = order.id
        localStorage.setItem(pendingStripeOrderKey(user.id), String(orderId))
      }
      const result = await paymentApi.createStripeCheckout(orderId)
      if (!result.checkout_url) throw new Error('The payment service did not return a checkout URL.')
      window.location.assign(result.checkout_url)
    } catch (error) {
      setPaymentError(error.message || 'Stripe checkout could not be started. Please try again.')
      setRedirecting(false)
    }
  }

  useEffect(() => {
    if (!paymentOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPaymentOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [paymentOpen])

  if (confirmed) return <main className="confirmation"><div className="success-mark"><Icon name="check" size={30}/></div><span className="eyebrow">Order confirmed</span><h1>Thank you for choosing<br/><em>handmade.</em></h1><p>Your order has been received. We’ll send the details and delivery updates to your email.</p><div className="order-number"><span>Order number</span><strong>SNS-20260801-0001</strong><button>Copy</button></div><div className="confirmation-actions"><button className="primary" onClick={() => go('shop')}>Continue shopping</button><button className="secondary" onClick={() => go('track')}>Track this order</button></div></main>
  return <main className="checkout-page"><div className="checkout-heading"><button className="back" onClick={() => go('shop')}>← Back to shop</button><span className="eyebrow">A simple final step</span><h1>Checkout</h1><p>No account needed. Choose how you’d like to continue.</p></div>
    <div className="checkout-layout"><section className="checkout-form"><div className="mode-tabs"><button className={mode === 'guest' ? 'active' : ''} disabled={isLoggedIn || !LIVE_MODE} onClick={() => setMode('guest')}><span>Guest checkout</span><small>{!LIVE_MODE ? 'Available when the store goes live' : isLoggedIn ? 'Unavailable while signed in' : 'Quick, no account needed'}</small></button><button className={mode === 'customer' ? 'active' : ''} disabled={!isLoggedIn} onClick={() => setMode('customer')}><span>{isLoggedIn ? customerName : 'Customer checkout'}</span><small>{isLoggedIn ? 'Checkout with saved details' : 'Sign in to use customer checkout'}</small></button></div>
      <form key={`${mode}-${user?.id || 'guest'}`} onSubmit={submitCheckout}><h2>{mode === 'guest' ? 'Where should we send it?' : 'Confirm your delivery details'}</h2><div className="field-grid"><label>Full name<input required name="name" defaultValue={isLoggedIn && mode === 'customer' ? customerName : ''} placeholder="Your full name"/></label><label>Email address<input required name="email" type="email" defaultValue={isLoggedIn && mode === 'customer' ? user?.email || '' : ''} placeholder="you@example.com"/></label><label>Phone number<input required name="phone" type="tel" defaultValue={isLoggedIn && mode === 'customer' ? user?.phone || '' : ''} placeholder="+65 0000 0000"/></label><label className="wide">Shipping address<textarea required name="shippingAddress" placeholder="Street, unit number, postal code"/></label></div>
        <section className="payment-section" aria-labelledby="payment-heading"><div className="payment-heading"><div><span className="eyebrow">Payment method</span><h2 id="payment-heading">Choose how to pay</h2></div><strong>S${orderTotal.toFixed(2)}</strong></div><div className="payment-options"><label className={paymentMethod === 'stripe' ? 'selected' : ''}><input type="radio" name="paymentMethod" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')}/><span><b>Credit/debit card or PayNow</b><small>{isLoggedIn ? 'Secure payment powered by Stripe' : 'Sign in required for Stripe payment'}</small></span><strong>Stripe</strong></label><label className={paymentMethod === 'paynow' ? 'selected' : ''}><input type="radio" name="paymentMethod" checked={paymentMethod === 'paynow'} onChange={() => setPaymentMethod('paynow')}/><span><b>PayLah QR code</b><small>Scan using your PayLah app</small></span></label></div>{paymentMethod === 'paynow' && <><p className="payment-intro">Open the payment window to scan the merchant QR code.</p><button className="secondary payment-open" type="button" onClick={() => setPaymentOpen(true)}>{paymentConfirmed ? 'View PayLah QR again' : 'Open PayLah payment'} <Icon name="arrow" size={17}/></button>{paymentConfirmed && <p className="payment-status"><Icon name="check" size={15}/> Payment marked as completed</p>}</>}</section>
        <label className="checkbox"><input type="checkbox"/> Send me occasional notes from the studio</label>{paymentError && <p className="payment-error" role="alert">{paymentError}</p>}<button className="primary full" disabled={!cart.length || redirecting || (paymentMethod === 'paynow' && !paymentConfirmed)}>{redirecting ? 'Opening secure checkout…' : paymentMethod === 'stripe' ? `Pay S$${orderTotal.toFixed(2)} with Stripe` : `Confirm payment & place order · S$${orderTotal.toFixed(2)}`} {!redirecting && <Icon name="arrow" size={18}/>}</button><p className="secure">{paymentMethod === 'stripe' ? 'You’ll continue to Stripe’s secure checkout. Card details never touch our servers.' : 'PayNow payment is confirmed manually.'}</p></form>
      {paymentOpen && <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="paynow-modal-title" onClick={() => setPaymentOpen(false)}><div className="payment-modal-panel" onClick={(event) => event.stopPropagation()}><button className="icon-button payment-modal-close" type="button" onClick={() => setPaymentOpen(false)} aria-label="Close PayLah payment"><Icon name="close" /></button><span className="eyebrow">Manual QR payment</span><h2 id="paynow-modal-title">Pay with PayLah</h2><div className="paynow-layout"><img src="/paynow-qr.jpeg" alt="PayLah QR code for Shilp and Soul payment"/><div><h3>Scan to pay S${orderTotal.toFixed(2)}</h3><ol><li>Open your PayLah app and select Scan & Pay.</li><li>Verify the merchant name displayed in the app.</li><li>Enter exactly <strong>S${orderTotal.toFixed(2)}</strong> and complete payment.</li></ol><p>Never proceed if the app shows an unexpected recipient.</p></div></div><label className="checkbox payment-confirmation"><input checked={paymentConfirmed} type="checkbox" onChange={(event) => setPaymentConfirmed(event.target.checked)}/> I have paid S${orderTotal.toFixed(2)} using PayLah</label><button className="primary full" type="button" disabled={!paymentConfirmed} onClick={() => setPaymentOpen(false)}>Done <Icon name="check" size={17}/></button></div></div>}
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
  return <section className="login-modal"><div className="login-visual"><button className="brand light"><span>shilp</span><i>&</i><span>soul</span></button><div><span className="eyebrow">Welcome home</span><blockquote>“Beautiful things are<br/>made to be lived with.”</blockquote><p>Sign in to revisit your orders and saved details.</p></div><small>Crafted with care · Singapore</small></div><div className="login-form"><button className="icon-button login-close" onClick={close} aria-label="Close"><Icon name="close"/></button><span className="eyebrow">Customer account</span><h2>Welcome back</h2><p>Enter your details to continue.</p><form onSubmit={submit}><label>Email address<input required name="email" type="email" autoComplete="email" placeholder="you@example.com"/></label><label><span>Password <button type="button">Forgot password?</button></span><input required name="password" type="password" autoComplete="current-password" placeholder="••••••••"/></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} {!submitting && <Icon name="arrow" size={18}/>}</button></form>{LIVE_MODE ? <><div className="or"><span>or</span></div><p className="signup">New to Shilp & Soul? <button>Create an account</button></p><button className="guest-link" onClick={close}>Continue shopping as guest</button></> : <p className="development-notice">New accounts and guest checkout will be available when the store goes live.</p>}</div></section>
}

function TrackOrder() { const [found, setFound] = useState(false); return <main className="utility-page"><div className="utility-card"><span className="eyebrow">Guest order tracking</span><h1>Where is my order?</h1><p>Enter your order number and the email or phone used at checkout.</p><form onSubmit={(e) => { e.preventDefault(); setFound(true) }}><label>Order number<input required placeholder="SNS-20260801-0001" defaultValue="SNS-20260801-0001"/></label><label>Email or phone<input required placeholder="you@example.com" defaultValue="guest@example.com"/></label><button className="primary full">Track order <Icon name="arrow" size={18}/></button></form>{found && <div className="tracking-result"><div><span>Order status</span><strong>Preparing your pieces</strong></div><div className="progress"><i></i></div><div className="steps"><b>Confirmed</b><b>Preparing</b><span>Dispatched</span><span>Delivered</span></div><p>Estimated dispatch in 1–2 working days.</p></div>}</div></main> }

function Orders() { return <main className="orders-page"><span className="eyebrow">Your collection</span><h1>My orders</h1><p>Keep track of the beautiful things you’ve chosen.</p><div className="catalog-status">Your order history will appear here.</div></main> }

export default App
