import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const endpoint = process.env.PRODUCT_API_URL || 'https://shilpnsoul-backend-admin.vercel.app/api/products?_start=0&_end=1000'
const response = await fetch(endpoint)
if (!response.ok) throw new Error(`Product catalog returned ${response.status}`)
const payload = await response.json()
const products = Array.isArray(payload) ? payload : payload.data || []
const urls = [...new Set(products.filter((product) => product.is_active !== false).flatMap((product) => {
  if (Array.isArray(product.images) && product.images.length) return product.images
  return product.image_url ? [product.image_url] : []
}).filter((url) => /^https?:\/\//i.test(url)))]

await mkdir('public/product-images', { recursive: true })
const manifest = JSON.parse(await readFile('src/product-image-manifest.json', 'utf8').catch(() => '{}'))
let cursor = 0
const failures = []

async function worker() {
  while (cursor < urls.length) {
    const url = urls[cursor++]
    if (manifest[url]) continue
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
    try {
      const imageResponse = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`)
      const source = Buffer.from(await imageResponse.arrayBuffer())
      await Promise.all([480, 960].map((width) => sharp(source, { failOn: 'none' })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toFile(`public/product-images/${hash}-${width}.webp`)))
      manifest[url] = `/product-images/${hash}`
    } catch (error) {
      failures.push({ url, reason: error.message })
    }
  }
}

await Promise.all(Array.from({ length: 6 }, worker))
await writeFile('src/product-image-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Optimized ${Object.keys(manifest).length}/${urls.length} images. Failed: ${failures.length}.`)
if (failures.length) {
  console.error(failures.slice(0, 10))
  process.exitCode = 1
}
