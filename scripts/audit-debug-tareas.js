// Script de debug específico para encontrar la URL que da 400 en /crm/tareas/nueva
const { chromium } = require('playwright')

const BASE = 'http://localhost:3000'
const EMAIL = 'audit@fidcore.local'
const PASSWORD = 'audittest123'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  page.on('response', async (resp) => {
    const status = resp.status()
    if (status >= 400) {
      let body = ''
      try { body = (await resp.text()).slice(0, 500) } catch {}
      console.log(`[HTTP ${status}] ${resp.request().method()} ${resp.url()}`)
      if (body) console.log(`  BODY: ${body}`)
    }
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[JS ERR] ${msg.text().slice(0, 400)}`)
    }
  })

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL(/\/crm\//, { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ])
  console.log('--- Login OK ---')

  // Ir a tareas/nueva y observar
  console.log('--- Cargando /crm/tareas/nueva ---')
  await page.goto(`${BASE}/crm/tareas/nueva`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  await browser.close()
})()
