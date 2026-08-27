import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { authApi, cartApi, catalogApi, orderApi, paymentApi } from './api'
import { getSessionUser, saveSession, startGuestSession } from './session'

const FALLBACK_IMAGE = '/product-placeholder.svg'
const LIVE_MODE = import.meta.env.VITE_LIVE_MODE === 'true'
const GUEST_CART_KEY = 'shoppingCart:guest'
const pendingStripeOrderKey = (userId) => `pendingStripeOrder:${userId}`
const paymentReturn = () => window.location.pathname.replace(/\/$/, '')
const initialView = () => ['/payment/cancel', '/payment/success'].includes(paymentReturn()) ? 'checkout' : 'shop'
const hasConstrainedConnection = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  return Boolean(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || ''))
}

const savedGuestCart = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(GUEST_CART_KEY))
    return Array.isArray(saved) ? saved.filter((item) => item.productColorId) : []
  } catch {
    return []
  }
}

const cartRecords = (payload) => Array.isArray(payload) ? payload : payload?.items || payload?.cart_items || []
const cartLineKey = (item) => item.lineKey || `${item.id}:${item.productColorId}`
const hydrateCart = (payload, products) => cartRecords(payload).flatMap((record) => {
  const productId = record.product_id ?? record.productId ?? record.product?.id
  const product = products.find((candidate) => String(candidate.id) === String(productId))
  if (!product) return []
  const productColorId = record.product_color_id ?? record.productColorId
  const selectedColor = product.colors?.find((color) => String(color.id) === String(productColorId))
  return [{ ...product, quantity: Number(record.quantity) || 1, cartItemId: record.id, productColorId, color: record.color || selectedColor?.color || '', stock: Number(record.available_quantity ?? selectedColor?.quantity ?? product.stock), lineKey: `${product.id}:${productColorId}` }]
})

const removeLegacyUserCarts = () => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('shoppingCart:user:') || key.startsWith('pendingStripeOrder:'))
    .forEach((key) => localStorage.removeItem(key))
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
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [view, setView] = useState(initialView)
  const [cartOpen, setCartOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [user, setUser] = useState(getSessionUser)
  const isLoggedIn = Boolean(user)
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [banners, setBanners] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [cart, setCart] = useState(() => user ? [] : savedGuestCart())
  const [checkoutMode, setCheckoutMode] = useState(() => user || !LIVE_MODE ? 'customer' : 'guest')
  const [confirmed, setConfirmed] = useState(() => paymentReturn() === '/payment/success')
  const [toast, setToast] = useState(() => paymentReturn() === '/payment/cancel' ? 'Payment cancelled. Your bag has been kept.' : '')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => removeLegacyUserCarts(), [])

  useEffect(() => {
    const expireSession = () => {
      setUser(null)
      setCart([])
      setCheckoutMode('guest')
      setToast('Your session expired. Please sign in again.')
    }
    window.addEventListener('auth:expired', expireSession)
    return () => window.removeEventListener('auth:expired', expireSession)
  }, [])

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
          sessionStorage.removeItem(pendingStripeOrderKey(user.id))
          cartApi.load().then(cartApi.clear).catch(() => setToast('Order completed, but the bag could not be cleared.'))
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
        const [productRecords, categoryRecords, bannerRecords] = await Promise.all([
          catalogApi.products(),
          catalogApi.categories(),
          catalogApi.banners().catch(() => []),
        ])
        if (!active) return
        const activeCategories = categoryRecords.filter((category) => category.is_active !== false)
        const categoryNames = new Map(activeCategories.map((category) => [String(category.id), category.name]))
        setCategories(activeCategories)
        setBanners(bannerRecords
          .filter((banner) => banner.is_active !== false && /^https?:\/\//i.test(String(banner.blob_url)))
          .sort((first, second) => Number(first.sort_order) - Number(second.sort_order) || Number(first.id) - Number(second.id)))
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
    if (!user) sessionStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart))
  }, [cart, user])

  useEffect(() => {
    if (!user?.id || products.length === 0) return undefined
    let active = true
    cartApi.load()
      .then((payload) => { if (active) setCart(hydrateCart(payload, products)) })
      .catch((error) => { if (active) setToast(error.message || 'Unable to load your bag') })
    return () => { active = false }
  }, [products, user])

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)

  const refreshUserCart = async (cartId) => setCart(hydrateCart(cartId ? await cartApi.get(cartId) : await cartApi.load(), products))

  const addToCart = async (product, selectedColor) => {
    if (!selectedColor) {
      setToast(`Choose a colour for ${product.name}`)
      return
    }
    const lineKey = `${product.id}:${selectedColor.id}`
    if (user) {
      try {
        const existing = cart.find((item) => cartLineKey(item) === lineKey)
        if (existing) await cartApi.update(existing.cartItemId, Math.min(existing.quantity + 1, existing.stock))
        else {
          const activeCart = await cartApi.load()
          await cartApi.add(activeCart.id, product.id, selectedColor.id, 1)
          await refreshUserCart(activeCart.id)
          setToast(`${product.name} added to your bag`)
          window.setTimeout(() => setToast(''), 2200)
          return
        }
        await refreshUserCart()
      } catch (error) {
        setToast(error.message || 'Unable to update your bag')
        return
      }
    } else {
    setCart((current) => current.some((item) => cartLineKey(item) === lineKey)
      ? current.map((item) => cartLineKey(item) === lineKey ? { ...item, quantity: Math.min(item.quantity + 1, item.stock) } : item)
      : [...current, { ...product, quantity: 1, productColorId: selectedColor.id, color: selectedColor.color, stock: Number(selectedColor.quantity), lineKey }])
    }
    setToast(`${product.name} added to your bag`)
    window.setTimeout(() => setToast(''), 2200)
  }

  const updateQuantity = async (lineKey, delta) => {
    if (!user) {
      setCart((current) => current
        .map((item) => cartLineKey(item) === lineKey ? { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + delta)) } : item)
        .filter((item) => item.quantity > 0))
      return
    }
    const item = cart.find((candidate) => cartLineKey(candidate) === lineKey)
    if (!item) return
    const quantity = Math.max(0, Math.min(item.stock, item.quantity + delta))
    try {
      if (quantity === 0) await cartApi.remove(item.cartItemId)
      else await cartApi.update(item.cartItemId, quantity)
      await refreshUserCart()
    } catch (error) {
      setToast(error.message || 'Unable to update your bag')
    }
  }

  const removeFromCart = async (lineKey) => {
    const item = cart.find((candidate) => cartLineKey(candidate) === lineKey)
    if (!item) return
    if (!user) {
      setCart((current) => current.filter((candidate) => cartLineKey(candidate) !== lineKey))
      setToast(`${item.name} removed from your bag`)
      return
    }
    try {
      await cartApi.remove(item.cartItemId)
      await refreshUserCart()
      setToast(`${item.name} removed from your bag`)
    } catch (error) {
      setToast(error.message || 'Unable to remove this item')
    }
  }

  const go = (next) => {
    setView(next)
    setCartOpen(false)
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const showProducts = () => {
    setView('shop')
    setCartOpen(false)
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector('.collection')?.scrollIntoView({ behavior: 'smooth' })
    }))
  }
  const openSearch = () => {
    setView('shop')
    setSearchOpen(true)
    window.requestAnimationFrame(() => document.querySelector('.site-search input')?.focus())
  }
  const login = (session) => {
    saveSession(session)
    sessionStorage.removeItem(GUEST_CART_KEY)
    setCart([])
    setUser(session.user)
    setCheckoutMode('customer')
    setLoginOpen(false)
    setToast(`Welcome back, ${session.user.first_name}`)
  }
  const logout = () => {
    startGuestSession()
    setUser(null)
    setCart([])
    setConfirmed(false)
    setCheckoutMode('guest')
    go('shop')
    setLoginOpen(true)
    setToast('You have been signed out')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Open menu"><Icon name="menu" /></button>
        <button className="brand" onClick={() => go('shop')}><span>shilp</span><i>&</i><span>soul</span></button>
        <nav aria-label="Main navigation">
          <button className={view === 'shop' ? 'active' : ''} onClick={() => go('shop')}>Shop</button>
          <button onClick={showProducts}>New arrivals</button>
          {!isLoggedIn && <button onClick={() => go('track')}>Track order</button>}
          {isLoggedIn && <button onClick={() => go('orders')}>My orders</button>}
        </nav>
        <div className="header-actions">
          <button className="icon-button search-button" aria-label="Search products" aria-expanded={searchOpen} onClick={() => searchOpen ? setSearchOpen(false) : openSearch()}><Icon name="search" /></button>
          <button className="account-button" onClick={() => isLoggedIn ? go('orders') : setLoginOpen(true)}><Icon name="user"/><span>{isLoggedIn ? `Hi, ${user.first_name}` : 'Sign in'}</span></button>
          {isLoggedIn && <button className="logout-button" onClick={logout}>Log out</button>}
          <button className="icon-button bag-button" onClick={() => setCartOpen(true)} aria-label={`Shopping bag with ${count} items`}><Icon name="bag"/><b>{count}</b></button>
        </div>
      </header>
      {searchOpen && <div className="site-search"><label><Icon name="search" size={18}/><span className="sr-only">Search products or categories</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search products or categories…" /></label><button className="icon-button" onClick={() => { setSearchOpen(false); setSearchQuery('') }} aria-label="Close search"><Icon name="close" size={18}/></button></div>}

      {view === 'shop' && <Shop products={products} categories={categories} banners={banners} loading={catalogLoading} error={catalogError} cart={cart} addToCart={addToCart} updateQuantity={updateQuantity} removeFromCart={removeFromCart} searchQuery={searchQuery} showProducts={showProducts} />}
      {view === 'checkout' && <Checkout cart={cart} total={total} mode={checkoutMode} setMode={setCheckoutMode} user={user} isLoggedIn={isLoggedIn} onConfirm={() => setConfirmed(true)} confirmed={confirmed} go={go} />}
      {view === 'track' && !isLoggedIn && <TrackOrder />}
      {view === 'track' && isLoggedIn && <Orders products={products} />}
      {view === 'orders' && <Orders products={products} />}

      <footer>
        <div className="footer-brand"><div className="brand light"><span>shilp</span><i>&</i><span>soul</span></div><p>Objects with a story. Made slowly,<br/>chosen thoughtfully.</p></div>
        <div><h4>Explore</h4><a>Our story</a><a>Artisans</a><a>Journal</a></div>
        <div><h4>Help</h4><a>Shipping & returns</a>{!isLoggedIn && <button onClick={() => go('track')}>Track an order</button>}<a>Contact us</a></div>
        <div className="newsletter"><h4>Notes from the studio</h4><p>New collections, craft stories, and quiet inspiration.</p><label><span className="sr-only">Email address</span><input type="email" placeholder="Your email address"/><button aria-label="Subscribe"><Icon name="arrow"/></button></label></div>
      </footer>

      {cartOpen && <><div className="scrim" onClick={() => setCartOpen(false)}/><CartDrawer cart={cart} total={total} updateQuantity={updateQuantity} close={() => setCartOpen(false)} checkout={() => isLoggedIn ? go('checkout') : (setCartOpen(false), setLoginOpen(true))} /></>}
      {loginOpen && <><div className="scrim" onClick={() => { startGuestSession(); setLoginOpen(false) }}/><Login close={() => { startGuestSession(); setLoginOpen(false) }} success={login} continueAsGuest={() => { startGuestSession(); setLoginOpen(false); setCheckoutMode('guest'); if (cart.length) go('checkout') }} /></>}
      {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}
    </div>
  )
}

function Shop({ products, categories, banners, loading, error, cart, addToCart, updateQuantity, removeFromCart, searchQuery, showProducts }) {
  const [categoryId, setCategoryId] = useState('all')
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroPaused, setHeroPaused] = useState(hasConstrainedConnection)
  const [heroSource, updateHeroSource] = useState(() => localStorage.getItem('heroImageSource') === 'banner' ? 'banner' : 'product')
  const productSlides = useMemo(() => products.flatMap((product) => product.images.map((image, index) => ({
    id: `product-${product.id}-${index}`,
    image,
    label: product.name,
    alt: `${product.name}${product.images.length > 1 ? `, image ${index + 1}` : ''}`,
  }))), [products])
  const bannerSlides = useMemo(() => banners.map((banner) => ({
    id: `banner-${banner.id}`,
    image: banner.blob_url,
    label: banner.title || banner.alt_text || 'Featured collection',
    alt: banner.alt_text || banner.title || 'Featured collection',
    link: banner.link_url,
  })), [banners])
  const heroSlides = heroSource === 'banner' ? bannerSlides : productSlides
  const setHeroSource = (source) => {
    setHeroIndex(0)
    updateHeroSource(source)
    localStorage.setItem('heroImageSource', source)
  }
  useEffect(() => {
    if (heroPaused || heroSlides.length < 2) return undefined
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [heroPaused, heroSlides.length])
  const heroSlide = heroSlides[heroIndex] || null
  const categoryFilteredProducts = categoryId === 'all'
    ? products
    : products.filter((product) => String(product.category_id) === categoryId)
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleProducts = normalizedSearch
    ? products.filter((product) => `${product.name} ${product.craft}`.toLowerCase().includes(normalizedSearch))
    : categoryFilteredProducts

  return <main>
    {!normalizedSearch && <><section className="hero-section">
      <div className="hero-copy"><span className="eyebrow">Handmade for the everyday</span><h1>Live with things<br/><em>that have a soul.</em></h1><p>Thoughtful objects, made by hand across India. Each piece carries the mark of its maker.</p><button className="primary" onClick={showProducts}>Explore the collection <Icon name="arrow" size={18}/></button></div>
      <div className="hero-art"><div className="hero-image" role="img" aria-label={heroSlide?.alt || 'Handcrafted home decor'} style={heroSlide ? { backgroundImage: `url("${heroSlide.image}")` } : undefined}></div><div className="hero-source" role="group" aria-label="Choose hero image source"><button type="button" className={heroSource === 'banner' ? 'selected' : ''} onClick={() => setHeroSource('banner')}>Banner</button><button type="button" className={heroSource === 'product' ? 'selected' : ''} onClick={() => setHeroSource('product')}>Product</button></div><div className="hero-controls"><button type="button" onClick={() => setHeroPaused((paused) => !paused)} aria-label={heroPaused ? 'Start automatic hero images' : 'Pause automatic hero images'}><Icon name={heroPaused ? 'play' : 'pause'} size={16}/><span>{heroPaused ? 'Start' : 'Pause'}</span></button><button type="button" disabled={heroSlides.length < 2} onClick={() => setHeroIndex((current) => (current + 1) % heroSlides.length)} aria-label="Show next hero image"><span>Next</span><Icon name="chevron" size={16}/></button></div><div className="maker-note"><span>{heroSource === 'banner' ? 'Featured banner' : 'From the collection'}</span><strong>{heroSlide?.label || (heroSource === 'banner' ? 'No active banners' : 'Objects made with care')}</strong><button aria-label={heroSlide ? `View ${heroSlide.label}` : 'Explore the collection'} onClick={() => heroSlide?.link ? window.location.assign(heroSlide.link) : document.querySelector('.collection')?.scrollIntoView({ behavior: 'smooth' })}><Icon name="arrow" size={17}/></button></div><span className="shape shape-one"></span><span className="shape shape-two"></span></div>
    </section>
    <section className="story-strip"><p><span>01</span> Small-batch</p><p><span>02</span> Artisan-made</p><p><span>03</span> Responsibly sourced</p><p><span>04</span> Made to last</p></section></>}
    <section className={`collection${normalizedSearch ? ' search-results' : ''}`} id="products">
      <div className="section-head"><div><span className="eyebrow">{normalizedSearch ? 'Search results' : 'Curated for you'}</span><h2>{normalizedSearch ? `${visibleProducts.length} ${visibleProducts.length === 1 ? 'piece' : 'pieces'} found` : 'Objects of quiet beauty'}</h2></div>{!normalizedSearch && <button>View all pieces <Icon name="arrow" size={17}/></button>}</div>
      <div className="filters" aria-label="Product categories"><button className={categoryId === 'all' ? 'selected' : ''} onClick={() => setCategoryId('all')}>All objects</button>{categories.map((category) => <button className={categoryId === String(category.id) ? 'selected' : ''} onClick={() => setCategoryId(String(category.id))} key={category.id}>{category.name}</button>)}</div>
      {loading && <div className="catalog-status" role="status">Loading the collection…</div>}
      {error && <div className="catalog-status error" role="alert">{error}</div>}
      {!loading && !error && visibleProducts.length === 0 && <div className="catalog-status">{normalizedSearch ? `No products match “${searchQuery.trim()}”.` : 'No pieces are available in this category yet.'}</div>}
      <div className="product-grid">{visibleProducts.map((product) => <ProductCard product={product} cartEntries={cart.filter((item) => item.id === product.id)} addToCart={addToCart} updateQuantity={updateQuantity} removeFromCart={removeFromCart} key={product.id} />)}</div>
    </section>
    <section className="craft-callout"><div className="craft-image"></div><div><span className="eyebrow">The hands behind the work</span><h2>Craft is a conversation<br/>across generations.</h2><p>We work directly with independent makers and family workshops, honouring techniques that have been refined over centuries.</p><button className="text-link">Meet our makers <Icon name="arrow" size={18}/></button></div></section>
  </main>
}

function ProductCard({ product, cartEntries, addToCart, updateQuantity, removeFromCart }) {
  const images = product.images.length ? product.images : [FALLBACK_IMAGE]
  const colors = (product.colors || []).filter((color) => Number(color.quantity) > 0)
  const description = product.product_description || {}
  const [imageIndex, setImageIndex] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [expandedIndex, setExpandedIndex] = useState(0)
  const [selectedColorId, setSelectedColorId] = useState('')
  const selectedColor = colors.find((color) => String(color.id) === selectedColorId)
  const selectedCartEntry = cartEntries.find((item) => String(item.productColorId) === selectedColorId)
  const cartQuantity = cartEntries.reduce((sum, item) => sum + item.quantity, 0)

  useEffect(() => {
    if (!previewing || images.length < 2) return undefined
    const timer = window.setInterval(() => {
      setImageIndex((current) => (current + 1) % images.length)
    }, 900)
    return () => window.clearInterval(timer)
  }, [previewing, images.length])

  useEffect(() => {
    if (!expanded) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setExpanded(false)
      if (event.key === 'ArrowRight') setExpandedIndex((current) => (current + 1) % images.length)
      if (event.key === 'ArrowLeft') setExpandedIndex((current) => (current - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
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
        <img src={images[imageIndex]} alt={`${product.name}${images.length > 1 ? `, view ${imageIndex + 1} of ${images.length}` : ''}`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE }} />
      </button>
      {images.length > 1 && <span className="image-count" aria-hidden="true">{imageIndex + 1}/{images.length}</span>}
      <button className="wish" aria-label={`Save ${product.name}`}><Icon name="heart" size={18}/></button>
      <aside className="product-hover-details">
        {description.festive_note && <blockquote className="festive-note"><b>Festive note</b>{description.festive_note}</blockquote>}
        <span className="eyebrow">Product details</span><h4>{description.title || product.name}</h4>
        <p>{description.catalogue_description || product.description || 'A thoughtfully selected handcrafted piece.'}</p>
        {description.dimensions && <small><b>Dimensions</b>{description.dimensions}</small>}
        {description.pattern_craft && <small><b>Craft</b>{description.pattern_craft}</small>}
        <label>Choose colour<select value={selectedColorId} onChange={(event) => setSelectedColorId(event.target.value)}><option value="">Select colour</option>{colors.map((color) => <option value={color.id} key={color.id}>{color.color} ({color.quantity} available)</option>)}</select></label>
      </aside>
      <div className={`product-image-actions ${selectedCartEntry ? 'has-remove' : ''}`}>
        <button className="quick-add" disabled={!selectedColor} onClick={() => addToCart(product, selectedColor)}>{colors.length ? selectedColor ? 'Quick add' : 'Choose colour' : 'No colours available'} <Icon name="plus" size={16}/></button>
        {selectedCartEntry && <button className="reduce-in-bag" onClick={() => updateQuantity(cartLineKey(selectedCartEntry), -1)} aria-label={`Reduce ${product.name} in ${selectedCartEntry.color} by one`}>Reduce <Icon name="minus" size={14}/></button>}
        {selectedCartEntry && <button className="remove-from-bag" onClick={() => removeFromCart(cartLineKey(selectedCartEntry))} aria-label={`Remove ${product.name} in ${selectedCartEntry.color} from bag`}>Remove <Icon name="close" size={14}/></button>}
      </div>
    </div>
    <div className="product-meta"><div><h3>{product.name}</h3><p>{product.craft}</p><p className={`stock-availability ${product.stock < 1 ? 'out-of-stock' : ''}`}><span>{product.stock < 1 ? 'Out of stock' : `${product.stock} available`}</span>{cartQuantity > 0 && <b>{cartQuantity} in bag</b>}</p></div><strong>S${product.price.toFixed(2)}</strong></div>
    {expanded && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`${product.name} image gallery`} onClick={() => setExpanded(false)}>
      <div className="lightbox-panel product-gallery-panel" onClick={(event) => event.stopPropagation()}>
        <button className="lightbox-close icon-button" onClick={() => setExpanded(false)} aria-label="Close image gallery"><Icon name="close" /></button>
        <div className="gallery-visual"><button className="lightbox-main" onClick={() => setExpandedIndex((expandedIndex + 1) % images.length)} aria-label={images.length > 1 ? 'Show next image' : product.name}><img src={images[expandedIndex]} alt={`${product.name}, enlarged view ${expandedIndex + 1} of ${images.length}`} decoding="async" onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE }} /></button>
          {images.length > 1 && <><button className="gallery-arrow previous" onClick={() => setExpandedIndex((expandedIndex - 1 + images.length) % images.length)} aria-label="Previous image"><Icon name="chevron" /></button><button className="gallery-arrow next" onClick={() => setExpandedIndex((expandedIndex + 1) % images.length)} aria-label="Next image"><Icon name="chevron" /></button></>}
          <div className="gallery-thumbnails" aria-label="Choose product image">{images.map((url, index) => <button className={expandedIndex === index ? 'selected' : ''} onClick={() => setExpandedIndex(index)} aria-label={`View image ${index + 1}`} key={`${url}-${index}`}><img src={url} alt="" loading="lazy" decoding="async" /></button>)}</div><span className="lightbox-count">{expandedIndex + 1} / {images.length}</span></div>
        <aside className="gallery-product-details">{description.festive_note && <blockquote className="festive-note"><b>Festive note</b>{description.festive_note}</blockquote>}<span className="eyebrow">Product details</span><h2>{description.title || product.name}</h2><p>{description.catalogue_description || product.description}</p>{description.dimensions && <div><b>Dimensions</b><span>{description.dimensions}</span></div>}{description.color_description && <div><b>Colour</b><span>{description.color_description}</span></div>}{description.pattern_craft && <div><b>Pattern / craft</b><span>{description.pattern_craft}</span></div>}<label>Available colour<select value={selectedColorId} onChange={(event) => setSelectedColorId(event.target.value)}><option value="">Select colour</option>{colors.map((color) => <option value={color.id} key={color.id}>{color.color} ({color.quantity} available)</option>)}</select></label><button className="primary full" disabled={!selectedColor} onClick={() => addToCart(product, selectedColor)}>Add selected colour <Icon name="plus" size={16}/></button></aside>
      </div>
    </div>}
  </article>
}

function CartDrawer({ cart, total, updateQuantity, close, checkout }) {
  return <aside className="cart-drawer" aria-label="Shopping bag"><div className="drawer-head"><div><span className="eyebrow">Your selection</span><h2>Shopping bag <small>{cart.length}</small></h2></div><button className="icon-button" onClick={close} aria-label="Close bag"><Icon name="close"/></button></div>
    <div className="cart-items">{cart.length === 0 ? <div className="empty"><Icon name="bag" size={35}/><h3>Your bag is empty</h3><p>Beautiful things are waiting.</p></div> : cart.map((item) => <div className="cart-item" key={cartLineKey(item)}><img src={item.image} alt=""/><div className="cart-info"><h3>{item.name}</h3><p>{item.craft}</p><p className="cart-color"><b>Colour</b> {item.color}</p><div className="quantity"><button onClick={() => updateQuantity(cartLineKey(item), -1)} aria-label="Decrease quantity"><Icon name="minus" size={14}/></button><span>{item.quantity}</span><button onClick={() => updateQuantity(cartLineKey(item), 1)} aria-label="Increase quantity"><Icon name="plus" size={14}/></button></div></div><strong>S${item.price * item.quantity}</strong></div>)}</div>
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
  const [checkoutEmail, setCheckoutEmail] = useState(isLoggedIn && mode === 'customer' ? user?.email || '' : '')
  const [verificationId, setVerificationId] = useState(null)
  const [verificationToken, setVerificationToken] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')
  const accountEmailConfirmed = Boolean(isLoggedIn && user?.email_verified_at && checkoutEmail.trim().toLowerCase() === String(user.email).toLowerCase())
  const notificationConfirmed = accountEmailConfirmed || Boolean(verificationToken)

  const changeCheckoutEmail = (event) => {
    setCheckoutEmail(event.target.value)
    setVerificationId(null)
    setVerificationToken('')
    setVerificationCode('')
    setVerificationMessage('')
  }

  const requestCheckoutCode = async () => {
    setVerificationBusy(true)
    setVerificationMessage('')
    setPaymentError('')
    try {
      const result = await authApi.requestVerification(checkoutEmail.trim().toLowerCase(), 'CHECKOUT')
      if (result.verified) setVerificationMessage('Your saved email is already verified.')
      else {
        setVerificationId(result.verification_id)
        setVerificationMessage('A six-digit code was sent to your email.')
      }
    } catch (error) { setPaymentError(error.message) }
    finally { setVerificationBusy(false) }
  }

  const confirmCheckoutCode = async () => {
    setVerificationBusy(true)
    setPaymentError('')
    try {
      const result = await authApi.verifyCode(verificationId, verificationCode, isLoggedIn)
      setVerificationToken(result.verification_token)
      setVerificationMessage('Email confirmed for this order.')
    } catch (error) { setPaymentError(error.message) }
    finally { setVerificationBusy(false) }
  }

  const submitCheckout = async (event) => {
    event.preventDefault()
    setPaymentError('')
    setRedirecting(true)
    const data = new FormData(event.currentTarget)
    try {
      if (!notificationConfirmed) throw new Error('Confirm the email notification channel before placing your order.')
      const pendingKey = pendingStripeOrderKey(user?.id || 'guest')
      let pending
      try { pending = JSON.parse(sessionStorage.getItem(pendingKey)) } catch { pending = null }
      if (!pending?.id) {
        const details = {
          shipping_name: data.get('name'), shipping_phone: data.get('phone'), shipping_address: data.get('shippingAddress'),
          contact_email: checkoutEmail.trim().toLowerCase(), contact_phone: data.get('phone'), payment_method: paymentMethod === 'stripe' ? 'STRIPE' : 'CASH',
          notification_channel: 'EMAIL', notification_destination: checkoutEmail.trim().toLowerCase(), notification_verification_token: verificationToken,
        }
        const items = cart.map(({ id, productColorId, quantity }) => ({ product_id: id, product_color_id: productColorId, quantity }))
        const order = isLoggedIn ? await orderApi.checkout({ ...details, items }) : await orderApi.guestCheckout(details, items)
        pending = { id: order.id, orderNumber: order.order_number, accessToken: order.order_access_token || '' }
        sessionStorage.setItem(pendingKey, JSON.stringify(pending))
      }
      if (paymentMethod !== 'stripe') return onConfirm(pending)
      const result = await paymentApi.createStripeCheckout(pending.id, pending.accessToken)
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

  if (confirmed) return <main className="confirmation"><div className="success-mark"><Icon name="check" size={30}/></div><span className="eyebrow">Order confirmed</span><h1>Thank you for choosing<br/><em>handmade.</em></h1><p>Your order has been received. We’ll send the details and delivery updates to your email.</p><div className="order-number"><span>Order number</span><strong>SNS-20260801-0001</strong><button>Copy</button></div><div className="confirmation-actions"><button className="primary" onClick={() => go('shop')}>Continue shopping</button><button className="secondary" onClick={() => go(isLoggedIn ? 'orders' : 'track')}>{isLoggedIn ? 'View my orders' : 'Track this order'}</button></div></main>
  return <main className="checkout-page"><div className="checkout-heading"><button className="back" onClick={() => go('shop')}>← Back to shop</button><span className="eyebrow">A simple final step</span><h1>Checkout</h1><p>No account needed. Choose how you’d like to continue.</p></div>
    <div className="checkout-layout"><section className="checkout-form"><div className="mode-tabs"><button className={mode === 'guest' ? 'active' : ''} disabled={isLoggedIn || !LIVE_MODE} onClick={() => setMode('guest')}><span>Guest checkout</span><small>{!LIVE_MODE ? 'Available when the store goes live' : isLoggedIn ? 'Unavailable while signed in' : 'Quick, no account needed'}</small></button><button className={mode === 'customer' ? 'active' : ''} disabled={!isLoggedIn} onClick={() => setMode('customer')}><span>{isLoggedIn ? customerName : 'Customer checkout'}</span><small>{isLoggedIn ? 'Checkout with saved details' : 'Sign in to use customer checkout'}</small></button></div>
      <form key={`${mode}-${user?.id || 'guest'}`} onSubmit={submitCheckout}><h2>{mode === 'guest' ? 'Where should we send it?' : 'Confirm your delivery details'}</h2><div className="field-grid"><label>Full name<input required name="name" defaultValue={isLoggedIn && mode === 'customer' ? customerName : ''} placeholder="Your full name"/></label><label>Email address<input required name="email" type="email" value={checkoutEmail} onChange={changeCheckoutEmail} placeholder="you@example.com"/></label><label>Phone number<input required name="phone" type="tel" defaultValue={isLoggedIn && mode === 'customer' ? user?.phone || '' : ''} placeholder="+65 0000 0000"/></label><label className="wide">Shipping address<textarea required name="shippingAddress" placeholder="Street, unit number, postal code"/></label></div>
        <section className="notification-confirmation" aria-labelledby="notification-heading"><div><span className="eyebrow">Order notifications</span><h2 id="notification-heading">Confirm where we should send updates</h2></div><div className="notification-channels" role="radiogroup" aria-label="Notification channel"><label className="selected"><input type="radio" checked readOnly/> Email</label><label aria-disabled="true"><input type="radio" disabled/> WhatsApp <small>Setup pending</small></label></div>{accountEmailConfirmed ? <p className="verification-success"><Icon name="check" size={15}/> Your account email is verified.</p> : <><button className="secondary" type="button" onClick={requestCheckoutCode} disabled={verificationBusy || !checkoutEmail}>{verificationId ? 'Resend code' : 'Send verification code'}</button>{verificationId && !verificationToken && <div className="otp-entry"><label>Six-digit code<input inputMode="numeric" maxLength="6" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}/></label><button className="secondary" type="button" disabled={verificationBusy || verificationCode.length !== 6} onClick={confirmCheckoutCode}>Confirm email</button></div>}{verificationToken && <p className="verification-success"><Icon name="check" size={15}/> Email confirmed.</p>}</>}{verificationMessage && <p className="verification-note" role="status">{verificationMessage}</p>}</section>
        <section className="payment-section" aria-labelledby="payment-heading"><div className="payment-heading"><div><span className="eyebrow">Payment method</span><h2 id="payment-heading">Choose how to pay</h2></div><strong>S${orderTotal.toFixed(2)}</strong></div><div className="payment-options"><label className={paymentMethod === 'stripe' ? 'selected' : ''}><input type="radio" name="paymentMethod" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')}/><span><b>Credit/debit card or PayNow</b><small>Secure payment powered by Stripe</small></span><strong>Stripe</strong></label><label className={paymentMethod === 'paynow' ? 'selected' : ''}><input type="radio" name="paymentMethod" checked={paymentMethod === 'paynow'} onChange={() => setPaymentMethod('paynow')}/><span><b>PayLah QR code</b><small>Scan using your PayLah app</small></span></label></div>{paymentMethod === 'paynow' && <><p className="payment-intro">Open the payment window to scan the merchant QR code.</p><button className="secondary payment-open" type="button" onClick={() => setPaymentOpen(true)}>{paymentConfirmed ? 'View PayLah QR again' : 'Open PayLah payment'} <Icon name="arrow" size={17}/></button>{paymentConfirmed && <p className="payment-status"><Icon name="check" size={15}/> Payment marked as completed</p>}</>}</section>
        <label className="checkbox"><input type="checkbox"/> Send me occasional notes from the studio</label>{paymentError && <p className="payment-error" role="alert">{paymentError}</p>}<button className="primary full" disabled={!cart.length || !notificationConfirmed || redirecting || (paymentMethod === 'paynow' && !paymentConfirmed)}>{redirecting ? 'Opening secure checkout…' : paymentMethod === 'stripe' ? `Pay S$${orderTotal.toFixed(2)} with Stripe` : `Confirm payment & place order · S$${orderTotal.toFixed(2)}`} {!redirecting && <Icon name="arrow" size={18}/>}</button><p className="secure">{paymentMethod === 'stripe' ? 'You’ll continue to Stripe’s secure checkout. Card details never touch our servers.' : 'PayNow payment is confirmed manually.'}</p></form>
      {paymentOpen && <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="paynow-modal-title" onClick={() => setPaymentOpen(false)}><div className="payment-modal-panel" onClick={(event) => event.stopPropagation()}><button className="icon-button payment-modal-close" type="button" onClick={() => setPaymentOpen(false)} aria-label="Close PayLah payment"><Icon name="close" /></button><span className="eyebrow">Manual QR payment</span><h2 id="paynow-modal-title">Pay with PayLah</h2><div className="paynow-layout"><img src="/paynow-qr.jpeg" alt="PayLah QR code for Shilp and Soul payment"/><div><h3>Scan to pay S${orderTotal.toFixed(2)}</h3><ol><li>Open your PayLah app and select Scan & Pay.</li><li>Verify the merchant name displayed in the app.</li><li>Enter exactly <strong>S${orderTotal.toFixed(2)}</strong> and complete payment.</li></ol><p>Never proceed if the app shows an unexpected recipient.</p></div></div><label className="checkbox payment-confirmation"><input checked={paymentConfirmed} type="checkbox" onChange={(event) => setPaymentConfirmed(event.target.checked)}/> I have paid S${orderTotal.toFixed(2)} using PayLah</label><button className="primary full" type="button" disabled={!paymentConfirmed} onClick={() => setPaymentOpen(false)}>Done <Icon name="check" size={17}/></button></div></div>}
    </section><OrderSummary cart={cart} total={total}/></div>
  </main>
}

function OrderSummary({ cart, total }) { return <aside className="order-summary"><div className="summary-head"><h2>Your order</h2><span>{cart.length} items</span></div>{cart.map(item => <div className="summary-item" key={cartLineKey(item)}><div><img src={item.image} alt=""/><b>{item.quantity}</b></div><p><strong>{item.name}</strong><span>{item.craft} · {item.color}</span></p><em>S${(item.price * item.quantity).toFixed(2)}</em></div>)}<div className="summary-lines"><p><span>Subtotal</span><b>S${total.toFixed(2)}</b></p><p><span>Delivery</span><b>{total >= 150 ? 'Complimentary' : 'S$8.00'}</b></p></div><div className="summary-total"><span>Total <small>SGD</small></span><strong>S${(total + (total >= 150 ? 0 : 8)).toFixed(2)}</strong></div></aside> }

function Login({ close, success, continueAsGuest }) {
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [verificationId, setVerificationId] = useState(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [verificationMessage, setVerificationMessage] = useState('')

  const requestRegistrationCode = async () => {
    setSubmitting(true);setError('');setVerificationMessage('')
    try{const result=await authApi.requestVerification(registrationEmail.trim().toLowerCase(),'REGISTRATION');setVerificationId(result.verification_id);setVerificationMessage('A six-digit code was sent to your email.')}
    catch(requestError){setError(requestError.message)}finally{setSubmitting(false)}
  }

  const confirmRegistrationCode = async () => {
    setSubmitting(true);setError('')
    try{const result=await authApi.verifyCode(verificationId,verificationCode,false);setVerificationToken(result.verification_token);setVerificationMessage('Email verified. You can now create your account.')}
    catch(verifyError){setError(verifyError.message)}finally{setSubmitting(false)}
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const data = new FormData(event.currentTarget)
    try {
      startGuestSession()
      if(registering){
        if(!verificationToken)throw new Error('Verify your email before creating the account.')
        success(await authApi.register({first_name:data.get('firstName'),last_name:data.get('lastName'),email:registrationEmail.trim().toLowerCase(),phone:data.get('phone'),password:data.get('password'),verification_token:verificationToken}))
      }else success(await authApi.login(data.get('email'), data.get('password')))
    }
    catch (loginError) { setError(loginError.message) }
    finally { setSubmitting(false) }
  }
  return <section className="login-modal"><div className="login-visual"><button className="brand light"><span>shilp</span><i>&</i><span>soul</span></button><div><span className="eyebrow">Welcome home</span><blockquote>“Beautiful things are<br/>made to be lived with.”</blockquote><p>{registering?'Create an account with a verified email for simpler checkout.':'Sign in to revisit your orders and saved details.'}</p></div><small>Crafted with care · Singapore</small></div><div className="login-form"><button className="icon-button login-close" onClick={close} aria-label="Close"><Icon name="close"/></button><span className="eyebrow">Customer account</span><h2>{registering?'Create your account':'Welcome back'}</h2><p>{registering?'Verify your email before your account is created.':'Enter your details to continue.'}</p><form onSubmit={submit}>{registering&&<div className="registration-names"><label>First name<input required name="firstName" autoComplete="given-name"/></label><label>Last name<input required name="lastName" autoComplete="family-name"/></label></div>}<label>Email address<input required name="email" type="email" autoComplete="email" value={registering?registrationEmail:undefined} onChange={registering?(event)=>{setRegistrationEmail(event.target.value);setVerificationId(null);setVerificationToken('');setVerificationCode('')}:undefined} placeholder="you@example.com"/></label>{registering&&<><div className="registration-verification"><button className="secondary" type="button" disabled={submitting||!registrationEmail} onClick={requestRegistrationCode}>{verificationId?'Resend code':'Send verification code'}</button>{verificationId&&!verificationToken&&<><input aria-label="Six-digit verification code" inputMode="numeric" maxLength="6" value={verificationCode} onChange={(event)=>setVerificationCode(event.target.value.replace(/\D/g,'').slice(0,6))}/><button className="secondary" type="button" disabled={submitting||verificationCode.length!==6} onClick={confirmRegistrationCode}>Verify</button></>}</div>{verificationMessage&&<p className="verification-note" role="status">{verificationMessage}</p>}<label>Phone number<input name="phone" type="tel" autoComplete="tel" placeholder="+65 0000 0000"/></label></>}<label><span>Password {!registering&&<button type="button">Forgot password?</button>}</span><input required name="password" type="password" minLength={registering?12:undefined} autoComplete={registering?'new-password':'current-password'} placeholder="••••••••••••"/></label>{error&&<p className="login-error" role="alert">{error}</p>}<button className="primary full" disabled={submitting||(registering&&!verificationToken)}>{submitting?'Please wait…':registering?'Create account':'Sign in'} {!submitting&&<Icon name="arrow" size={18}/>}</button></form>{LIVE_MODE?<><div className="or"><span>or</span></div><p className="signup">{registering?'Already have an account?':'New to Shilp & Soul?'} <button type="button" onClick={()=>{setRegistering(!registering);setError('')}}>{registering?'Sign in':'Create an account'}</button></p><button className="guest-link" onClick={continueAsGuest}>Continue as guest</button></>:<p className="development-notice">New accounts and guest checkout will be available when the store goes live.</p>}</div></section>
}

function TrackOrder() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    const data = new FormData(event.currentTarget)
    try {
      setResult(await orderApi.track(String(data.get('orderNumber')).trim(), String(data.get('email')).trim().toLowerCase()))
    } catch (trackError) {
      setError(trackError.message || 'Unable to track this order.')
    } finally {
      setLoading(false)
    }
  }
  const resend = async () => {
    setLoading(true);setError('');setNotificationMessage('')
    try{await orderApi.resendGuestSummary(result.id,result.order_access_token);setNotificationMessage('Order summary sent to your confirmed email.')}
    catch(resendError){setError(resendError.message||'Unable to resend the order summary.')}finally{setLoading(false)}
  }
  const status = String(result?.status || '').toUpperCase()
  const progress = { PENDING: 15, CONFIRMED: 30, PROCESSING: 50, SHIPPED: 75, DELIVERED: 100 }[status] || 0
  return <main className="utility-page"><div className="utility-card"><span className="eyebrow">Guest order tracking</span><h1>Where is my order?</h1><p>Enter the order number and the same email address used during guest checkout.</p><form onSubmit={submit}><label>Order number<input required name="orderNumber" placeholder="ORD-…" autoComplete="off"/></label><label>Email address<input required name="email" type="email" placeholder="you@example.com" autoComplete="email"/></label><button className="primary full" disabled={loading}>{loading ? 'Finding your order…' : 'Track order'} {!loading && <Icon name="arrow" size={18}/>}</button></form>{error && <p className="login-error" role="alert">{error}</p>}{result && <div className="tracking-result"><div><span>Order status</span><strong>{status === 'PROCESSING' ? 'Preparing your pieces' : status}</strong></div><div className="progress"><i style={{ width: `${progress}%` }}></i></div><div className="steps"><b>Confirmed</b><span>Preparing</span><span>Dispatched</span><span>Delivered</span></div><p>Order {result.order_number} · Payment {result.payment_status}</p><button className="secondary" type="button" onClick={resend} disabled={loading}>Resend order email</button>{notificationMessage&&<p className="verification-success" role="status">{notificationMessage}</p>}</div>}</div></main>
}

function Orders({ products }) {
  const [orders, setOrders] = useState([])
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [orderSearch, setOrderSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(false)
  const [resendingOrderId, setResendingOrderId] = useState(null)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const loadOrders = async () => {
      try {
        const summaries = await orderApi.list()
        const detailed = await Promise.all(summaries.map(async (order) => {
          try { return await orderApi.get(order.id) }
          catch { return order }
        }))
        if (active) {
          setOrders(detailed)
          setSelectedOrderId(detailed[0]?.id ?? null)
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load your orders.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadOrders()
    return () => { active = false }
  }, [])

  const productImage = (productId) => products.find((product) => String(product.id) === String(productId))?.image || FALLBACK_IMAGE
  const normalizedOrderSearch = orderSearch.trim().toLowerCase()
  const matchingOrders = normalizedOrderSearch
    ? orders.filter((order) => String(order.order_number).toLowerCase().includes(normalizedOrderSearch))
    : orders
  const selectedOrder = matchingOrders.find((order) => String(order.id) === String(selectedOrderId)) || matchingOrders[0]
  const canRemoveSelectedOrder = selectedOrder && (selectedOrder.payment_status === 'PAID' || ['CANCELLED', 'RETURNED'].includes(selectedOrder.status))
  const removeSelectedOrder = async () => {
    if (!canRemoveSelectedOrder || !window.confirm(`Remove ${selectedOrder.order_number} from your order history?`)) return
    setRemoving(true)
    setError('')
    try {
      await orderApi.removeFromHistory(selectedOrder.id)
      const remaining = orders.filter((order) => String(order.id) !== String(selectedOrder.id))
      setOrders(remaining)
      setSelectedOrderId(remaining[0]?.id ?? null)
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove this order from your history.')
    } finally { setRemoving(false) }
  }
  const resendSelectedOrder = async () => {
    setResendingOrderId(selectedOrder.id)
    setNotificationMessage('')
    try {
      await orderApi.resendSummary(selectedOrder.id)
      setNotificationMessage('Order summary sent to your confirmed email.')
    } catch (resendError) { setError(resendError.message || 'Unable to resend the order summary.') }
    finally { setResendingOrderId(null) }
  }
  return <main className="orders-page"><span className="eyebrow">Your collection</span><h1>My orders</h1><p>Keep track of the beautiful things you’ve chosen.</p>
    {loading && <div className="catalog-status" role="status">Loading your orders…</div>}
    {error && <div className="catalog-status error" role="alert">{error}</div>}
    {!loading && !error && orders.length === 0 && <div className="catalog-status">You haven’t placed an order yet.</div>}
    {!loading && !error && orders.length > 0 && <div className="orders-workspace">
      <aside className="orders-list" aria-label="Order history">
        <div className="orders-list-heading"><span>Order history</span><b>{matchingOrders.length}</b></div>
        <label className="order-search"><Icon name="search" size={16}/><span className="sr-only">Search your orders</span><input type="search" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search order number" autoComplete="off"/></label>
        {matchingOrders.length === 0 && <div className="order-search-empty"><strong>No matching order</strong><span>Check the order number and try again.</span></div>}
        {matchingOrders.map((order) => <button type="button" className={`order-list-item ${String(order.id) === String(selectedOrder?.id) ? 'selected' : ''}`} onClick={() => setSelectedOrderId(order.id)} aria-pressed={String(order.id) === String(selectedOrder?.id)} key={order.id}>
          <span><strong>{order.order_number}</strong><small>{new Date(order.created_at).toLocaleDateString('en-SG')}</small></span>
          <span><b>{order.status}</b><small>S${Number(order.total_amount).toFixed(2)}</small></span>
        </button>)}
      </aside>
      {selectedOrder ? <article className="order-detail" aria-live="polite">
        <div className="order-detail-head"><div><span className="eyebrow">Order details</span><h2>{selectedOrder.order_number}</h2><p>Placed {new Date(selectedOrder.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div><strong className={`order-status ${String(selectedOrder.status).toLowerCase()}`}>{selectedOrder.status}</strong></div>
        <div className="order-detail-meta"><div><span>Payment</span><strong className={`order-payment ${String(selectedOrder.payment_status).toLowerCase()}`}>{selectedOrder.payment_status}</strong></div><div><span>Items</span><strong>{(selectedOrder.items || []).reduce((sum, item) => sum + Number(item.quantity), 0)}</strong></div><div><span>Total</span><strong>S${Number(selectedOrder.total_amount).toFixed(2)}</strong></div></div>
        <div className="order-detail-items">{(selectedOrder.items || []).map((item) => <div className="order-detail-item" key={item.id}><img src={productImage(item.product_id)} alt=""/><div><strong>{item.product_name}</strong><span>Quantity {item.quantity}{item.color ? ` · Colour ${item.color}` : ''}</span></div><b>S${Number(item.subtotal ?? Number(item.unit_price) * Number(item.quantity)).toFixed(2)}</b></div>)}</div>
        <div className="order-detail-total"><span>Order total</span><strong>S${Number(selectedOrder.total_amount).toFixed(2)}</strong></div>
        {notificationMessage && <p className="order-notification-message" role="status">{notificationMessage}</p>}
        <div className="order-history-actions"><button type="button" className="secondary" onClick={resendSelectedOrder} disabled={Boolean(resendingOrderId)}>{resendingOrderId ? 'Sending...' : 'Resend order email'}</button>{canRemoveSelectedOrder && <button type="button" className="secondary" onClick={removeSelectedOrder} disabled={removing}>{removing ? 'Removing...' : 'Remove from history'}</button>}</div>
      </article> : <div className="order-detail order-detail-empty"><Icon name="search" size={28}/><h2>No order selected</h2><p>Search by an order number from your account.</p></div>}
    </div>}
  </main>
}

export default App
