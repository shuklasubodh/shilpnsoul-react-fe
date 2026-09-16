const form = document.getElementById('deletion-form')
const status = document.getElementById('status')
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button')
  const values = new FormData(form)
  button.disabled = true
  status.textContent = 'Sending your request…'
  try {
    const response = await fetch('https://shilpnsoul-backend-admin.vercel.app/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(values.get('name') || '').trim(),
        email: String(values.get('email') || '').trim(),
        subject: 'Others',
        message: `Data deletion request: ${String(values.get('message') || '').trim()}`,
        request_id: crypto.randomUUID(),
        website: String(values.get('website') || ''),
      }),
    })
    if (!response.ok) throw new Error('Unable to send your request. Please try again later.')
    form.reset()
    status.textContent = 'Your request was received. Our support team will reply to your email address.'
  } catch (error) {
    status.textContent = error.message
  } finally {
    button.disabled = false
  }
})
