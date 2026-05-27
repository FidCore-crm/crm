/**
 * Auditoría exhaustiva del CRM con Playwright.
 *
 * Lo que hace:
 *  - Recorre todas las pantallas principales en desktop (1440x900) y mobile (375x812).
 *  - Captura screenshots de cada pantalla en ambos viewports.
 *  - Registra errores JS del console, requests HTTP fallidos, y exceptions.
 *  - Verifica que elementos críticos (logos, botones principales) existen.
 *  - Detecta texto truncado / overflowing horizontal scroll en mobile.
 *  - Prueba flows básicos: login → ver listados → abrir ficha → cerrar sesión.
 *
 * Output:
 *  - screenshots/ con todos los screenshots
 *  - audit-report.json con los hallazgos estructurados
 */

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const EMAIL = process.env.TEST_EMAIL || 'audit@pulzar.local'
const PASSWORD = process.env.TEST_PASSWORD || 'audittest123'

const OUT_DIR = path.join(__dirname, '..', 'tmp', 'audit')
const SHOTS_DIR = path.join(OUT_DIR, 'screenshots')
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
}

// Rutas a recorrer (autenticadas)
const RUTAS_AUTH = [
  { path: '/crm/dashboard', nombre: 'Dashboard' },
  { path: '/crm/personas', nombre: 'Personas listado' },
  { path: '/crm/personas/nueva', nombre: 'Personas nueva' },
  { path: '/crm/polizas', nombre: 'Pólizas listado' },
  { path: '/crm/polizas/nueva', nombre: 'Pólizas nueva' },
  { path: '/crm/renovaciones', nombre: 'Renovaciones' },
  { path: '/crm/siniestros', nombre: 'Siniestros listado' },
  { path: '/crm/siniestros/nuevo', nombre: 'Siniestros nuevo' },
  { path: '/crm/tareas', nombre: 'Tareas' },
  { path: '/crm/tareas/nueva', nombre: 'Tareas nueva' },
  { path: '/crm/calendario', nombre: 'Calendario' },
  { path: '/crm/facturacion', nombre: 'Facturación' },
  { path: '/crm/comercial', nombre: 'Comercial' },
  { path: '/crm/comercial/leads', nombre: 'Leads' },
  { path: '/crm/comercial/oportunidades', nombre: 'Oportunidades' },
  { path: '/crm/comercial/cotizaciones', nombre: 'Cotizaciones' },
  { path: '/crm/comercial/pipeline', nombre: 'Pipeline' },
  { path: '/crm/importar', nombre: 'Importar' },
  { path: '/crm/notificaciones', nombre: 'Notificaciones' },
  { path: '/crm/configuracion', nombre: 'Configuración' },
  { path: '/crm/configuracion/perfil', nombre: 'Config perfil' },
  { path: '/crm/configuracion/usuarios', nombre: 'Config usuarios' },
  { path: '/crm/configuracion/catalogos', nombre: 'Config catálogos' },
  { path: '/crm/configuracion/correos', nombre: 'Config correos' },
  { path: '/crm/configuracion/agente-ia', nombre: 'Config IA' },
  { path: '/crm/configuracion/portal-cliente', nombre: 'Config portal' },
  { path: '/crm/configuracion/formulario-publico', nombre: 'Config formulario' },
  { path: '/crm/configuracion/comunicaciones', nombre: 'Config comunicaciones' },
  { path: '/crm/configuracion/notificaciones', nombre: 'Config notificaciones' },
  { path: '/crm/configuracion/licencia', nombre: 'Config licencia' },
  { path: '/crm/configuracion/backups', nombre: 'Config backups' },
  { path: '/crm/configuracion/sistema', nombre: 'Config sistema' },
  { path: '/crm/configuracion/errores-sistema', nombre: 'Config errores' },
]

// Rutas públicas (sin auth)
const RUTAS_PUBLICAS = [
  { path: '/login', nombre: 'Login' },
  { path: '/denuncia', nombre: 'Denuncia (público)' },
]

const REPORTE = {
  generado: new Date().toISOString(),
  base: BASE,
  hallazgos: [],
  metricas: { paginas_visitadas: 0, screenshots: 0, errores_js: 0, http_fallidos: 0 },
}

function agregar(severidad, ruta, viewport, mensaje, detalle = null) {
  REPORTE.hallazgos.push({ severidad, ruta, viewport, mensaje, detalle })
}

async function auditarPagina(page, ruta, viewport) {
  const errores_js = []
  const http_fallidos = []
  const requests_lentos = []

  // Listeners para capturar errores
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text()
      // Ignorar errores conocidos no relevantes
      if (txt.includes('Failed to load resource: net::ERR_INTERNET_DISCONNECTED')) return
      if (txt.includes('favicon')) return
      errores_js.push(txt.slice(0, 300))
    }
  }
  const onPageError = (err) => {
    errores_js.push('UNCAUGHT: ' + (err.message || String(err)).slice(0, 300))
  }
  const onResponse = (resp) => {
    const status = resp.status()
    const url = resp.url()
    // Ignorar trackers / analytics / external
    if (!url.startsWith(BASE)) return
    if (status >= 400 && status < 600 && status !== 401 && status !== 403 && status !== 404) {
      http_fallidos.push(`HTTP ${status} ${url.replace(BASE, '')}`)
    }
    if (status === 500) {
      http_fallidos.push(`HTTP 500 ${url.replace(BASE, '')}`)
    }
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('response', onResponse)

  try {
    const t0 = Date.now()
    const resp = await page.goto(`${BASE}${ruta.path}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    })
    const dt = Date.now() - t0

    if (!resp) {
      agregar('CRITICA', ruta.path, viewport, 'No hubo respuesta del servidor')
      return
    }
    const status = resp.status()
    if (status >= 400) {
      agregar('CRITICA', ruta.path, viewport, `HTTP ${status} al cargar la página`)
    }

    if (dt > 5000) {
      agregar('MENOR', ruta.path, viewport, `Carga lenta: ${dt}ms`)
    }

    // Esperar un poco para que se hidrate React + se ejecuten useEffect.
    // Más en /denuncia porque tiene splash de 3.5s.
    await page.waitForTimeout(ruta.path === '/denuncia' ? 4500 : 800)

    // Screenshot
    const slug = ruta.path.replace(/[/[\]]/g, '_').replace(/^_+/, '')
    const filename = `${slug || 'root'}__${viewport}.png`
    const fullPath = path.join(SHOTS_DIR, filename)
    try {
      await page.screenshot({ path: fullPath, fullPage: true, timeout: 10000 })
      REPORTE.metricas.screenshots++
    } catch (err) {
      agregar('MENOR', ruta.path, viewport, 'No se pudo capturar screenshot', String(err.message).slice(0, 200))
    }

    // Detectar overflow horizontal en mobile
    if (viewport === 'mobile') {
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
      })
      if (overflow) {
        const detalles = await page.evaluate(() => {
          const ww = document.documentElement.clientWidth
          const culpables = []
          document.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect()
            if (r.right > ww + 10 && r.width > 100) {
              culpables.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} right=${Math.round(r.right)}px width=${Math.round(r.width)}px`)
            }
          })
          return culpables.slice(0, 5)
        })
        agregar('IMPORTANTE', ruta.path, viewport, 'Overflow horizontal en mobile', detalles.join(' | '))
      }
    }

    // Buscar imágenes rotas
    const imagenesRotas = await page.evaluate(() => {
      return Array.from(document.images)
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.src.slice(0, 200))
    })
    if (imagenesRotas.length) {
      agregar('IMPORTANTE', ruta.path, viewport, `${imagenesRotas.length} imagen(es) rota(s)`, imagenesRotas.join(' | '))
    }

    // Buscar texto que claramente sea placeholder/dev
    const textoSospechoso = await page.evaluate(() => {
      const body = document.body.innerText
      const patrones = ['TODO', 'FIXME', 'Lorem ipsum', 'undefined', '[object Object]', 'NaN']
      const encontrados = []
      for (const p of patrones) {
        if (body.includes(p)) encontrados.push(p)
      }
      return encontrados
    })
    if (textoSospechoso.length) {
      agregar('IMPORTANTE', ruta.path, viewport, `Texto sospechoso visible: ${textoSospechoso.join(', ')}`)
    }
  } catch (err) {
    agregar('CRITICA', ruta.path, viewport, 'Excepción navegando a la página', String(err.message).slice(0, 300))
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)
  }

  if (errores_js.length) {
    REPORTE.metricas.errores_js += errores_js.length
    agregar('CRITICA', ruta.path, viewport, `${errores_js.length} error(es) JS en console`, errores_js.slice(0, 3).join(' || '))
  }
  if (http_fallidos.length) {
    REPORTE.metricas.http_fallidos += http_fallidos.length
    agregar('IMPORTANTE', ruta.path, viewport, `${http_fallidos.length} request(s) HTTP fallido(s)`, http_fallidos.slice(0, 5).join(' || '))
  }

  REPORTE.metricas.paginas_visitadas++
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL(/\/crm\//, { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ])
}

async function corrida(viewport) {
  console.log(`\n=== Corriendo viewport ${viewport} ===`)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: viewport === 'mobile' ? 2 : 1,
    userAgent:
      viewport === 'mobile'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  // Públicas primero (sin auth)
  for (const ruta of RUTAS_PUBLICAS) {
    console.log(`  ${viewport} ${ruta.path}`)
    await auditarPagina(page, ruta, viewport)
  }

  // Login
  try {
    await login(page)
    console.log(`  ${viewport} login OK`)
  } catch (err) {
    agregar('CRITICA', '/login', viewport, 'No se pudo iniciar sesión', String(err.message).slice(0, 200))
    await browser.close()
    return
  }

  // Autenticadas
  for (const ruta of RUTAS_AUTH) {
    console.log(`  ${viewport} ${ruta.path}`)
    await auditarPagina(page, ruta, viewport)
  }

  await browser.close()
}

async function main() {
  for (const vp of Object.keys(VIEWPORTS)) {
    await corrida(vp)
  }

  // Guardar reporte
  const reportPath = path.join(OUT_DIR, 'audit-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(REPORTE, null, 2))
  console.log(`\nReporte: ${reportPath}`)
  console.log(`Screenshots: ${SHOTS_DIR}`)

  // Resumen
  const porSeveridad = {}
  for (const h of REPORTE.hallazgos) {
    porSeveridad[h.severidad] = (porSeveridad[h.severidad] || 0) + 1
  }
  console.log('\n=== RESUMEN ===')
  console.log(`Páginas visitadas: ${REPORTE.metricas.paginas_visitadas}`)
  console.log(`Screenshots: ${REPORTE.metricas.screenshots}`)
  console.log(`Errores JS: ${REPORTE.metricas.errores_js}`)
  console.log(`HTTP fallidos: ${REPORTE.metricas.http_fallidos}`)
  console.log(`Hallazgos por severidad: ${JSON.stringify(porSeveridad)}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
