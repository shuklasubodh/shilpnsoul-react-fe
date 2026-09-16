import sharp from 'sharp'

await sharp('public/shilpnsoul-app-icon.svg')
  .png()
  .toFile('public/shilpnsoul-app-icon.png')
