import sharp from 'sharp'

const names = [
  'meet-our-makers',
  'story-artisan-made',
  'story-made-to-last',
  'story-responsibly-sourced',
  'story-small-batch',
]

await Promise.all(names.flatMap((name) => [1200, 720].flatMap((width) => [
  sharp(`public/${name}.png`).resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toFile(`public/${name}-${width}.webp`),
  sharp(`public/${name}.png`).resize({ width, withoutEnlargement: true }).avif({ quality: 55, effort: 5 }).toFile(`public/${name}-${width}.avif`),
])))

console.log('Optimized editorial images generated in public/.')
