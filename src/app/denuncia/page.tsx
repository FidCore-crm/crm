'use client'

import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  TIPOS_VIVIENDA, QUE_PASO_HOGAR, RELACIONES_CONDUCTOR,
  MAX_TESTIGOS,
  type TipoRiesgoSiniestro, type TestigoData,
} from '@/lib/siniestros-tipos'
import { gradientDeColorMarca } from '@/lib/color-marca'
import { PoweredByFidCore } from '@/components/PoweredByFidCore'
import { tiposDeSiniestroPorRamo, obtenerConfigTipoSiniestro } from '@/lib/siniestros-catalogo'
import { CamposDinamicos, type ValoresDinamicos } from '@/components/siniestros/CamposDinamicos'

// ════════════════════════════════════════════════════════════
//   TIPOS
// ════════════════════════════════════════════════════════════

interface Organizacion {
  nombre: string
  logo_url: string | null
  color_marca?: string | null
}

interface PolizaDisponible {
  id: string
  numero_poliza: string
  compania: string
  ramo: string
  tipo_riesgo: TipoRiesgoSiniestro
  riesgo_resumen: string
  riesgo_id: string | null
  campos_dinamicos: any[]
}

interface DocSlots {
  // Cada slot guarda los archivos subidos (mínimo 1, idealmente 2 para frente/dorso)
  [slotId: string]: File[]
}

interface ExitoData {
  numero_caso: string
  email: string
}

interface FormConfig {
  activo: boolean
  titulo_hero: string
  subtitulo_hero: string
  mensaje_validacion_fallida: string
  mensaje_fuera_servicio: string
  terminos_activos: boolean
  terminos_titulo: string
  terminos_contenido: string | null
}

// ════════════════════════════════════════════════════════════
//   CONSTANTES
// ════════════════════════════════════════════════════════════

// Fallback de tipos genéricos — se usa solo cuando no hay ramo definido.
// Los tipos reales por ramo se calculan con tiposDeSiniestroPorRamo() de la matriz.
const TIPOS_SINIESTRO_FALLBACK = [
  { id: 'OTRO', label: 'Siniestro', icon: '📝' },
]

const PASOS = [
  'Asegurado y póliza',
  'Datos del siniestro',
  'Detalles + Documentación',
  'Resumen y envío',
]

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Documentación obligatoria para auto/moto. Cada doc tiene 2 slots (frente y
// dorso). Si "denuncia_policial" se marca como sí, agregamos un slot extra.
const DOCS_AUTO = [
  { id: 'licencia',       label: 'Licencia de conducir',   icon: '📋' },
  { id: 'cedula',         label: 'Cédula del vehículo',    icon: '🚗' },
  { id: 'dni_conductor',  label: 'DNI del conductor',      icon: '🆔' },
] as const

// Documentación obligatoria para no auto/moto: DNI del titular de la póliza.
const DOCS_NO_AUTO = [
  { id: 'dni_titular',    label: 'DNI del titular',        icon: '🆔' },
] as const

// Categorías de "otra persona o vehículo involucrado" — Opción C del rediseño.
// El backend persiste esto como `tercero_categoria` dentro de detalle_siniestro
// y, cuando aplica, mapea a `tercero_tipo_vehiculo` para conservar la columna.
const CATEGORIAS_INVOLUCRADO = [
  { value: 'vehiculo',      label: 'Otro vehículo',                icon: '🚗' },
  { value: 'moto',          label: 'Moto',                         icon: '🛵' },
  { value: 'bici',          label: 'Bicicleta',                    icon: '🚲' },
  { value: 'peaton',        label: 'Peatón',                       icon: '🚶' },
  { value: 'objeto_fijo',   label: 'Objeto fijo (poste, pared…)',  icon: '🧱' },
  { value: 'persona',       label: 'Otra persona',                 icon: '👤' },
  { value: 'otro',          label: 'Otro',                         icon: '❓' },
] as const

type CategoriaInvolucrado = typeof CATEGORIAS_INVOLUCRADO[number]['value']

// Categorías que requieren datos de vehículo (patente, marca, modelo, año).
const CATEGORIAS_CON_VEHICULO = new Set<CategoriaInvolucrado>(['vehiculo', 'moto', 'bici'])

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ════════════════════════════════════════════════════════════
//   COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════

export default function DenunciarPage() {
  return (
    <Suspense fallback={<div />}>
      <DenunciarPageContent />
    </Suspense>
  )
}

function DenunciarPageContent() {
  const searchParams = useSearchParams()
  const tokenCliente = searchParams?.get('token_cliente') || null
  const polizaIdQuery = searchParams?.get('poliza_id') || null

  const [pasoActual, setPasoActual] = useState(1)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashFading, setSplashFading] = useState(false)
  const [organizacion, setOrganizacion] = useState<Organizacion | null>(null)
  const [config, setConfig] = useState<FormConfig | null>(null)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState('')

  // Anti-bot — solo honeypot invisible. El captcha matemático se sacó por
  // fricción innecesaria; el honeypot ya bloquea la mayoría de bots.
  const [honeypot, setHoneypot] = useState('')

  // Pre-completado desde portal
  const [preCompletado, setPreCompletado] = useState(false)
  const [polizasToken, setPolizasToken] = useState<PolizaDisponible[]>([])

  // ── Estado del formulario ──
  // Paso 1: asegurado + póliza
  const [apellido, setApellido] = useState('')
  const [nombre, setNombre] = useState('')
  const [dni, setDni] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [polizaIdSeleccionada, setPolizaIdSeleccionada] = useState<string | null>(null)
  const [numeroPolizaManual, setNumeroPolizaManual] = useState('')
  const [validandoCliente, setValidandoCliente] = useState(false)

  // Paso 2: datos del siniestro
  const [tipoSiniestro, setTipoSiniestro] = useState('')
  const [tipoOtroDescripcion, setTipoOtroDescripcion] = useState('')
  const [fechaSiniestro, setFechaSiniestro] = useState('')
  const [horaSiniestro, setHoraSiniestro] = useState('')
  const [lugarSiniestro, setLugarSiniestro] = useState('')
  const [localidadSiniestro, setLocalidadSiniestro] = useState('')
  const [descripcion, setDescripcion] = useState('')

  // Paso 3 — Conductor (auto/moto)
  const [conductorEsAsegurado, setConductorEsAsegurado] = useState(true)
  const [conductorNombre, setConductorNombre] = useState('')
  const [conductorApellido, setConductorApellido] = useState('')
  const [conductorDni, setConductorDni] = useState('')
  const [conductorTelefono, setConductorTelefono] = useState('')
  const [conductorRelacion, setConductorRelacion] = useState('')
  const [conductorRegistro, setConductorRegistro] = useState('')

  // Paso 3 — Vehículo estacionado (auto/moto)
  const [vehiculoEstacionado, setVehiculoEstacionado] = useState<'si' | 'no' | ''>('')

  // Paso 3 — Tercero / Otra persona o vehículo involucrado (Opción C)
  const [huboTercero, setHuboTercero] = useState(false)
  const [terceroCategoria, setTerceroCategoria] = useState<CategoriaInvolucrado | ''>('')
  const [terceroFuga, setTerceroFuga] = useState(false)
  const [terceroNombre, setTerceroNombre] = useState('')
  const [terceroDni, setTerceroDni] = useState('')
  const [terceroTelefono, setTerceroTelefono] = useState('')
  const [terceroCompania, setTerceroCompania] = useState('')
  const [terceroPoliza, setTerceroPoliza] = useState('')
  const [terceroTipoVehiculo, setTerceroTipoVehiculo] = useState('')
  const [terceroPatente, setTerceroPatente] = useState('')
  const [terceroMarca, setTerceroMarca] = useState('')
  const [terceroModelo, setTerceroModelo] = useState('')
  const [terceroAnio, setTerceroAnio] = useState('')
  const [terceroDanos, setTerceroDanos] = useState('')

  // Paso 3 — Lesionados (auto/moto)
  const [huboLesionados, setHuboLesionados] = useState(false)
  const [detalleLesiones, setDetalleLesiones] = useState('')

  // Paso 3 — Testigos
  const [huboTestigos, setHuboTestigos] = useState(false)
  const [testigos, setTestigos] = useState<TestigoData[]>([{ nombre: '', telefono: '' }])

  // Paso 3 — Daños propios (auto/moto)
  const [danosPropios, setDanosPropios] = useState('')

  // Paso 3 — Hogar
  const [tipoVivienda, setTipoVivienda] = useState('')
  const [quePaso, setQuePaso] = useState('')
  const [ambienteAfectado, setAmbienteAfectado] = useState('')
  const [causaSiniestro, setCausaSiniestro] = useState('')

  // Paso 3 — Denuncia policial
  const [denunciaPolicial, setDenunciaPolicial] = useState<'si' | 'no' | ''>('')
  const [actaPolicial, setActaPolicial] = useState('')

  // Paso 3 — Documentación (slots)
  const [docSlots, setDocSlots] = useState<DocSlots>({})
  const [archivosGenerales, setArchivosGenerales] = useState<File[]>([])

  // Paso 3 — Campos custom configurados por el PAS en /crm/configuracion/catalogos
  // (ramo > "Campos del siniestro"). Cada póliza puede tener su propia lista.
  // Cuando viene por token: salen de polizaSeleccionada.campos_dinamicos.
  // Sin token: salen de polizaValidada (cargada en validatePaso1).
  const [valoresCustom, setValoresCustom] = useState<Record<string, string>>({})
  // Valores para tipos de siniestro que no son ACCIDENTE_TRANSITO (renderea CamposDinamicos).
  const [valoresDinamicos, setValoresDinamicos] = useState<ValoresDinamicos>({})
  const [polizaValidada, setPolizaValidada] = useState<{
    tipo_riesgo: string
    campos_dinamicos: any[]
  } | null>(null)

  // Paso 4
  const [declaracion, setDeclaracion] = useState(false)
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [mostrarTerminos, setMostrarTerminos] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<ExitoData | null>(null)

  // ── Derivados ──
  const polizaSeleccionada = useMemo(() => {
    if (!polizaIdSeleccionada) return null
    return polizasToken.find(p => p.id === polizaIdSeleccionada) || null
  }, [polizaIdSeleccionada, polizasToken])

  // Lista de campos custom activos para la póliza seleccionada (con token) o la
  // validada (sin token). Se calcula derivadamente para no duplicar la fuente
  // de verdad.
  const camposCustomActivos = useMemo(() => {
    const raw = polizaSeleccionada?.campos_dinamicos ?? polizaValidada?.campos_dinamicos ?? []
    if (!Array.isArray(raw)) return [] as Array<{ key: string; label: string; tipo: string; requerido?: boolean; placeholder?: string; opciones?: string }>
    return raw
      .filter((c: any) => c && typeof c === 'object' && typeof c.key === 'string' && typeof c.label === 'string')
      .map((c: any) => ({
        key: String(c.key),
        label: String(c.label),
        tipo: typeof c.tipo === 'string' ? c.tipo : 'text',
        requerido: Boolean(c.requerido),
        placeholder: typeof c.placeholder === 'string' ? c.placeholder : undefined,
        opciones: typeof c.opciones === 'string' ? c.opciones : undefined,
      }))
  }, [polizaSeleccionada, polizaValidada])

  const tipoRiesgo: TipoRiesgoSiniestro = polizaSeleccionada?.tipo_riesgo ?? 'generico'
  const esAutoMoto = tipoRiesgo === 'automotor' || tipoRiesgo === 'moto'
  const esHogar = tipoRiesgo === 'hogar'
  const esVida = tipoRiesgo === 'vida'

  // Tipos de siniestro válidos para el ramo actual (viene de la matriz).
  // Reemplaza a TIPOS_SINIESTRO_FALLBACK cuando hay ramo definido.
  const tiposValidos = useMemo(() => {
    if (!tipoRiesgo || tipoRiesgo === 'generico') return TIPOS_SINIESTRO_FALLBACK
    return tiposDeSiniestroPorRamo(tipoRiesgo).map(t => ({
      id: t.value,
      label: t.label,
      icon: t.icono ?? '📝',
    }))
  }, [tipoRiesgo])
  // Solo para ACCIDENTE_TRANSITO usamos los bloques hardcoded específicos del form público.
  const usarBloqueAutomotorHardcoded = esAutoMoto && tipoSiniestro === 'ACCIDENTE_TRANSITO'
  const esRobo = tipoSiniestro === 'ROBO'

  // Fecha local del cliente (no UTC). En Argentina entre 21:00 y 23:59
  // toISOString() ya devuelve el día siguiente y permitiría elegir fechas
  // "futuras" desde el form.
  const todayDate = new Date()
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`

  // ── Carga inicial ──
  useEffect(() => {
    fetch('/api/publico/organizacion')
      .then(r => r.json())
      .then(data => setOrganizacion(data))
      .catch(() => setOrganizacion({ nombre: 'Productor de Seguros', logo_url: null }))
    fetch('/api/publico/configuracion')
      .then(r => r.json())
      .then(data => setConfig(data))
      .catch(() => { /* config default */ })
  }, [])

  // Inyectar `color_marca` como CSS variables para que `denuncia.css` y los
  // estilos inline tomen el color del PAS en vez del navy default.
  // - `--color-marca`: color base (botones, acentos).
  // - `--color-marca-gradient`: gradient 135° derivado (splash, topbar, hero).
  useEffect(() => {
    const color = organizacion?.color_marca
    if (!color) return
    const gradient = gradientDeColorMarca(color)
    document.documentElement.style.setProperty('--color-marca', color)
    document.documentElement.style.setProperty('--color-marca-gradient', gradient)
    return () => {
      document.documentElement.style.removeProperty('--color-marca')
      document.documentElement.style.removeProperty('--color-marca-gradient')
    }
  }, [organizacion?.color_marca])

  // Al cambiar la lista de campos custom (cambio de póliza o nueva validación),
  // resetear los valores custom — así no queda un valor cargado para una key
  // que ya no aplica.
  useEffect(() => {
    setValoresCustom({})
  }, [polizaSeleccionada?.id, polizaValidada])

  // ── Pre-completar desde portal ──
  useEffect(() => {
    if (!tokenCliente) return
    fetch(`/api/publico/portal-cliente/pre-completar/${encodeURIComponent(tokenCliente)}`)
      .then(r => r.json())
      .then(data => {
        if (!data?.ok) return
        setApellido((data.apellido || '').toUpperCase())
        setNombre((data.nombre || '').toUpperCase())
        setDni(data.dni || '')
        setEmail(data.email || '')
        setTelefono(data.telefono || '')
        setLocalidadSiniestro(data.localidad || '')
        const polizas: PolizaDisponible[] = data.polizas || []
        setPolizasToken(polizas)
        if (polizaIdQuery && polizas.some(p => p.id === polizaIdQuery)) {
          setPolizaIdSeleccionada(polizaIdQuery)
        } else if (polizas.length === 1) {
          setPolizaIdSeleccionada(polizas[0].id)
        }
        setPreCompletado(true)
      })
      .catch(() => { /* form queda vacío */ })
  }, [tokenCliente, polizaIdQuery])

  // ── Splash (3.5s para que el branding del PAS sea claramente visible) ──
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFading(true), 3200)
    const hideTimer = setTimeout(() => setSplashVisible(false), 3500)
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer) }
  }, [])

  function clearError(field: string) {
    setErrores(prev => {
      if (!prev[field]) return prev
      const n = { ...prev }
      delete n[field]
      return n
    })
  }

  // ════════════════════════════════════════════
  //   VALIDACIONES POR PASO
  // ════════════════════════════════════════════

  function validatePaso1(): boolean {
    const e: Record<string, string> = {}
    if (!apellido.trim()) e.apellido = 'Requerido'
    if (!nombre.trim()) e.nombre = 'Requerido'
    if (!dni.trim()) e.dni = 'Requerido'
    else {
      const clean = dni.replace(/[.\s-]/g, '')
      if (!/^\d{7,11}$/.test(clean)) e.dni = 'Debe tener entre 7 y 11 dígitos'
    }
    if (!email.trim()) e.email = 'Requerido'
    else if (!EMAIL_REGEX.test(email.trim())) e.email = 'Formato inválido'
    if (!telefono.trim()) e.telefono = 'Requerido'

    if (preCompletado && polizasToken.length > 0) {
      if (!polizaIdSeleccionada) e.poliza = 'Seleccioná una póliza'
    } else {
      if (!numeroPolizaManual.trim()) e.numero_poliza = 'Requerido'
    }
    setErrores(e)
    return Object.keys(e).length === 0
  }

  function validatePaso2(): boolean {
    const e: Record<string, string> = {}
    if (!tipoSiniestro) e.tipo_siniestro = 'Seleccioná un tipo'
    if (tipoSiniestro === 'OTRO' && !tipoOtroDescripcion.trim())
      e.tipo_otro_descripcion = 'Especificá qué tipo de siniestro es'
    if (!fechaSiniestro) e.fecha_siniestro = 'Requerido'
    if (!lugarSiniestro.trim()) e.lugar_siniestro = 'Requerido'
    if (!localidadSiniestro.trim()) e.localidad_siniestro = 'Requerido'
    if (!descripcion.trim()) e.descripcion = 'Requerido'
    else if (descripcion.trim().length < 20) e.descripcion = 'Mínimo 20 caracteres'
    setErrores(e)
    return Object.keys(e).length === 0
  }

  function validatePaso3(): boolean {
    const e: Record<string, string> = {}

    // Conductor (auto/moto — solo ACCIDENTE_TRANSITO)
    if (usarBloqueAutomotorHardcoded && !conductorEsAsegurado) {
      if (!conductorNombre.trim()) e.conductor_nombre = 'Requerido'
      if (!conductorApellido.trim()) e.conductor_apellido = 'Requerido'
      if (!conductorDni.trim()) e.conductor_dni = 'Requerido'
      else {
        const clean = conductorDni.replace(/[.\s-]/g, '')
        if (!/^\d{7,11}$/.test(clean)) e.conductor_dni = 'DNI inválido'
      }
    }

    // Tercero / otra persona o vehículo involucrado (solo ACCIDENTE_TRANSITO)
    if (usarBloqueAutomotorHardcoded && huboTercero) {
      if (!terceroCategoria) {
        e.tercero_categoria = 'Indicá con qué o con quién'
      } else if (!terceroFuga && terceroCategoria !== 'objeto_fijo') {
        if (!terceroNombre.trim()) e.tercero_nombre = 'Requerido (o marcá "se dio a la fuga / no se identificó")'
      }
    }

    // Testigos (solo ACCIDENTE_TRANSITO)
    if (usarBloqueAutomotorHardcoded && huboTestigos) {
      const validos = testigos.filter(t => t.nombre.trim() || t.telefono.trim())
      if (validos.length === 0) e.testigos = 'Cargá al menos un testigo o desactivá esta opción'
    }

    // Lesionados (solo ACCIDENTE_TRANSITO)
    if (usarBloqueAutomotorHardcoded && huboLesionados && !detalleLesiones.trim()) {
      e.detalle_lesiones = 'Describí brevemente las lesiones'
    }

    // Validación de tipos no-accidente: los campos requeridos del bloque dinámico
    if (tipoSiniestro && !usarBloqueAutomotorHardcoded) {
      const configTipo = obtenerConfigTipoSiniestro(tipoRiesgo, tipoSiniestro)
      if (configTipo) {
        for (const campo of configTipo.campos) {
          if (campo.requerido) {
            const valor = (valoresDinamicos as Record<string, unknown>)[campo.key]
            if (valor == null || (typeof valor === 'string' && !valor.trim())) {
              e[campo.key] = `${campo.label} es obligatorio`
            }
          }
        }
        // Si el tipo requiere selector_rueda, validar que se eligió una
        if (configTipo.bloques.includes('selector_rueda') && !valoresDinamicos.rueda_robada) {
          e.rueda_robada = 'Marcá qué rueda robaron'
        }
      }
    }

    // Hogar
    if (esHogar) {
      if (!quePaso) e.que_paso = 'Seleccioná qué pasó'
    }

    // Denuncia policial
    if (esRobo && denunciaPolicial !== 'si') {
      e.denuncia_policial = 'En caso de robo la denuncia policial es obligatoria'
    }

    // Documentación auto/moto: licencia + cédula + DNI conductor frente y dorso
    if (esAutoMoto) {
      for (const doc of DOCS_AUTO) {
        const frente = docSlots[`${doc.id}_frente`] || []
        const dorso = docSlots[`${doc.id}_dorso`] || []
        if (frente.length === 0) e[`doc_${doc.id}_frente`] = 'Subí la foto del frente'
        if (dorso.length === 0) e[`doc_${doc.id}_dorso`] = 'Subí la foto del dorso'
      }
    }

    // Documentación no-auto: DNI del titular obligatorio (frente y dorso)
    if (!esAutoMoto) {
      for (const doc of DOCS_NO_AUTO) {
        const frente = docSlots[`${doc.id}_frente`] || []
        const dorso = docSlots[`${doc.id}_dorso`] || []
        if (frente.length === 0) e[`doc_${doc.id}_frente`] = 'Subí la foto del frente'
        if (dorso.length === 0) e[`doc_${doc.id}_dorso`] = 'Subí la foto del dorso'
      }
    }

    // Denuncia policial: el archivo es obligatorio solo si es robo. Si dijo
    // "sí" en otro caso, el slot está disponible pero no obligamos.
    if (esRobo) {
      const den = docSlots['denuncia_policial'] || []
      if (den.length === 0) e.doc_denuncia_policial = 'Subí la denuncia policial'
    }

    // Campos custom (configurados por el PAS en el catálogo del ramo).
    // Solo validamos los `requerido: true`.
    for (const c of camposCustomActivos) {
      if (!c.requerido) continue
      const v = (valoresCustom[c.key] || '').trim()
      if (!v) e[`custom_${c.key}`] = `Completá "${c.label}"`
    }

    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ════════════════════════════════════════════
  //   NAVEGACIÓN
  // ════════════════════════════════════════════

  async function siguiente() {
    setErrorGeneral('')
    if (pasoActual === 1) {
      if (!validatePaso1()) return
      // Si vino con token, ya validamos arriba (los datos vienen pre-completados).
      // Sin token: validar contra backend.
      if (!preCompletado) {
        setValidandoCliente(true)
        try {
          const res = await fetch('/api/publico/validar-cliente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dni: dni.replace(/[.\s-]/g, ''),
              email: email.trim(),
              numero_poliza: numeroPolizaManual.trim(),
            }),
          })
          const data = await res.json()
          if (!data.ok) {
            setErrorGeneral(config?.mensaje_validacion_fallida || data.error || 'Los datos no coinciden con nuestro sistema.')
            setValidandoCliente(false)
            return
          }
          // Guardar tipo_riesgo + campos_dinamicos para que el paso 3 pueda
          // renderear los campos custom configurados por el PAS.
          setPolizaValidada({
            tipo_riesgo: data.poliza?.tipo_riesgo ?? '',
            campos_dinamicos: Array.isArray(data.poliza?.campos_dinamicos) ? data.poliza.campos_dinamicos : [],
          })
        } catch {
          setErrorGeneral('Error de conexión. Intentá nuevamente.')
          setValidandoCliente(false)
          return
        }
        setValidandoCliente(false)
      }
      setPasoActual(2)
    } else if (pasoActual === 2) {
      if (!validatePaso2()) return
      setPasoActual(3)
    } else if (pasoActual === 3) {
      if (!validatePaso3()) return
      setPasoActual(4)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function anterior() {
    setErrorGeneral('')
    setErrores({})
    setPasoActual(p => Math.max(1, p - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ════════════════════════════════════════════
  //   ENVÍO
  // ════════════════════════════════════════════

  async function enviarDenuncia() {
    if (!declaracion) {
      setErrorGeneral('Tenés que aceptar la declaración jurada para continuar.')
      return
    }
    if (config?.terminos_activos && !aceptaTerminos) {
      setErrorGeneral('Tenés que aceptar los términos y condiciones para continuar.')
      return
    }
    setErrorGeneral('')
    setEnviando(true)

    try {
      const fd = new FormData()
      fd.append('apellido', apellido.trim().toUpperCase())
      fd.append('nombre', nombre.trim().toUpperCase())
      fd.append('dni', dni.replace(/[.\s-]/g, ''))
      fd.append('email', email.trim())
      fd.append('telefono', telefono.trim())

      // Póliza: si hay seleccionada (vía token), enviar id; si no, número manual.
      if (polizaSeleccionada) {
        fd.append('poliza_id', polizaSeleccionada.id)
        fd.append('numero_poliza', polizaSeleccionada.numero_poliza)
      } else {
        fd.append('numero_poliza', numeroPolizaManual.trim())
      }

      fd.append('tipo_siniestro', tipoSiniestro)
      if (tipoSiniestro === 'OTRO' && tipoOtroDescripcion.trim()) {
        fd.append('tipo_otro_descripcion', tipoOtroDescripcion.trim())
      }
      fd.append('fecha_siniestro', fechaSiniestro)
      if (horaSiniestro) fd.append('hora_siniestro', horaSiniestro)
      fd.append('lugar_siniestro', lugarSiniestro.trim())
      fd.append('localidad_siniestro', localidadSiniestro.trim())
      fd.append('descripcion', descripcion.trim())

      // Conductor + bloques específicos de auto — solo si ACCIDENTE_TRANSITO
      if (usarBloqueAutomotorHardcoded) {
        fd.append('conductor_es_asegurado', conductorEsAsegurado ? 'si' : 'no')
        if (!conductorEsAsegurado) {
          fd.append('conductor_nombre', conductorNombre.trim())
          fd.append('conductor_apellido', conductorApellido.trim())
          fd.append('conductor_dni', conductorDni.replace(/[.\s-]/g, ''))
          if (conductorTelefono) fd.append('conductor_telefono', conductorTelefono.trim())
          if (conductorRelacion) fd.append('conductor_relacion', conductorRelacion.trim())
          if (conductorRegistro) fd.append('conductor_registro', conductorRegistro.trim())
        }

        // Vehículo estacionado
        if (vehiculoEstacionado) fd.append('vehiculo_estacionado', vehiculoEstacionado)

        // Tercero / Otra persona o vehículo involucrado (Opción C)
        fd.append('hubo_tercero', huboTercero ? 'si' : 'no')
        if (huboTercero) {
          if (terceroCategoria) fd.append('tercero_categoria', terceroCategoria)
          fd.append('tercero_fuga', terceroFuga ? 'si' : 'no')
          if (!terceroFuga) {
            if (terceroNombre)       fd.append('tercero_nombre', terceroNombre.trim())
            if (terceroDni)          fd.append('tercero_dni', terceroDni.replace(/[.\s-]/g, ''))
            if (terceroTelefono)     fd.append('tercero_telefono', terceroTelefono.trim())
            if (terceroCompania)     fd.append('tercero_compania', terceroCompania.trim())
            if (terceroPoliza)       fd.append('tercero_poliza', terceroPoliza.trim())
            // Mantenemos `tercero_tipo_vehiculo` por compat: cuando la categoría
            // implica vehículo, copiamos la categoría también ahí.
            if (terceroTipoVehiculo) {
              fd.append('tercero_tipo_vehiculo', terceroTipoVehiculo)
            } else if (terceroCategoria && CATEGORIAS_CON_VEHICULO.has(terceroCategoria)) {
              fd.append('tercero_tipo_vehiculo', terceroCategoria)
            }
            if (terceroPatente)      fd.append('tercero_patente', terceroPatente.toUpperCase().trim())
            if (terceroMarca)        fd.append('tercero_marca', terceroMarca.trim())
            if (terceroModelo)       fd.append('tercero_modelo', terceroModelo.trim())
            if (terceroAnio)         fd.append('tercero_anio', terceroAnio.trim())
            if (terceroDanos)        fd.append('tercero_danos', terceroDanos.trim())
          }
        }

        // Lesionados
        fd.append('hubo_lesionados', huboLesionados ? 'si' : 'no')
        if (huboLesionados && detalleLesiones) fd.append('detalle_lesiones', detalleLesiones.trim())

        // Daños propios
        if (danosPropios) fd.append('danos_propios', danosPropios.trim())
      }

      // Hogar
      if (esHogar) {
        if (tipoVivienda)     fd.append('tipo_vivienda', tipoVivienda)
        if (quePaso)          fd.append('que_paso', quePaso)
        if (ambienteAfectado) fd.append('ambiente_afectado', ambienteAfectado.trim())
        if (causaSiniestro)   fd.append('causa_siniestro', causaSiniestro.trim())
      }

      // Testigos
      if (huboTestigos) {
        fd.append('hubo_testigos', 'si')
        const validos = testigos.filter(t => t.nombre.trim() || t.telefono.trim()).slice(0, MAX_TESTIGOS)
        validos.forEach((t, i) => {
          if (t.nombre)   fd.append(`testigo_${i + 1}_nombre`, t.nombre.trim())
          if (t.telefono) fd.append(`testigo_${i + 1}_telefono`, t.telefono.trim())
        })
      }

      // Denuncia policial
      if (denunciaPolicial) fd.append('denuncia_policial', denunciaPolicial)
      if (actaPolicial)     fd.append('acta_policial', actaPolicial.trim())

      // Valores del bloque dinámico (para tipos no-accidente: ROBO_RUEDAS, GRANIZO, etc.).
      // Se serializan como JSON y el backend los mergea al detalle_siniestro.
      if (tipoSiniestro && !usarBloqueAutomotorHardcoded && Object.keys(valoresDinamicos).length > 0) {
        // Filtrar valores vacíos antes de mandar.
        const limpio: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(valoresDinamicos)) {
          if (v == null || v === '' || v === false) continue
          if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0) continue
          if (Array.isArray(v) && v.length === 0) continue
          limpio[k] = v
        }
        if (Object.keys(limpio).length > 0) {
          fd.append('valores_dinamicos', JSON.stringify(limpio))
        }
      }

      // Campos custom configurados por el PAS — se mandan con prefijo `custom_`
      // para que el backend los identifique y los meta en `detalle_siniestro`.
      for (const c of camposCustomActivos) {
        const v = (valoresCustom[c.key] || '').trim()
        if (v) fd.append(`custom_${c.key}`, v)
      }

      // Archivos: cada slot agrega su categoría como prefijo
      // (licencia_frente, licencia_dorso, cedula_frente, ..., denuncia_policial, generales)
      for (const [slotId, files] of Object.entries(docSlots)) {
        for (const file of files) {
          fd.append('archivos', file)
          fd.append('archivos_categoria', slotId)
        }
      }
      for (const file of archivosGenerales) {
        fd.append('archivos', file)
        fd.append('archivos_categoria', 'generales')
      }

      // Anti-bot — solo honeypot invisible
      fd.append('website_honeypot', honeypot)

      const res = await fetch('/api/publico/siniestros', { method: 'POST', body: fd })
      const data = await res.json()

      if (data.ok) {
        setExito({
          numero_caso: data.numero_caso,
          email: data.email_enviado_a || email.trim(),
        })
      } else {
        setErrorGeneral(data.error || 'Ocurrió un error. Intentá nuevamente o contactá a tu productor.')
      }
    } catch {
      setErrorGeneral('Error de conexión. Intentá nuevamente.')
    } finally {
      setEnviando(false)
    }
  }

  // ════════════════════════════════════════════
  //   RENDERS DE PASO 1-4
  // ════════════════════════════════════════════

  if (splashVisible) {
    return (
      <div className={`splash-overlay ${splashFading ? 'fade-out' : ''}`}>
        {organizacion?.logo_url ? (
          <img src={organizacion.logo_url} alt="" className="splash-logo" />
        ) : (
          <div className="splash-logo-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        )}
        <div className="splash-name">{organizacion?.nombre || 'Cargando...'}</div>
        <div className="splash-spinner" />
        <div className="splash-text">Preparando formulario...</div>
      </div>
    )
  }

  if (config && config.activo === false) {
    return (
      <>
        <TopBar organizacion={organizacion} />
        <div className="form-container">
          <div className="form-card">
            <div className="success-screen">
              <div className="success-icon" style={{ background: '#fef3c7' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 40, height: 40 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h1 className="success-title">Formulario fuera de servicio</h1>
              <p className="success-subtitle">{config.mensaje_fuera_servicio}</p>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (exito) {
    return (
      <>
        <TopBar organizacion={organizacion} />
        <div className="form-container">
          <div className="form-card">
            <div className="success-screen">
              <div className="success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 className="success-title">¡Denuncia registrada!</h1>
              <p className="success-subtitle">
                Tu denuncia fue recibida correctamente. En breve recibirás un email de confirmación con todos los detalles.
              </p>
              <div className="success-card">
                <div className="success-caso-label">Número de caso</div>
                <div className="success-caso-numero">{exito.numero_caso}</div>
                <div className="success-email-label">Email de confirmación enviado a</div>
                <div className="success-email-value">{exito.email}</div>
              </div>
              <p className="success-info">
                Guardá este número para futuras consultas. Tu productor asesor se pondrá en contacto
                con vos a la brevedad para continuar con el proceso.
              </p>
              <button className="btn btn-primary btn-lg" onClick={() => window.location.reload()}>
                Volver al inicio
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar organizacion={organizacion} />
      <div className="form-container">
        {/* Hero */}
        <div className="hero-banner">
          <div className="hero-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Denuncia Online
          </div>
          <h1 className="hero-title">{config?.titulo_hero || 'Denunciar Siniestro'}</h1>
          <p className="hero-subtitle">
            {config?.subtitulo_hero || 'Completá los datos de tu siniestro de forma rápida y segura. Te llegará una constancia por email.'}
          </p>
        </div>

        <ProgressBar pasoActual={pasoActual} />

        <div className="form-card">
          {errorGeneral && (
            <div className="alert-error">
              <span className="alert-error-icon">⚠</span>
              <span className="alert-error-text">{errorGeneral}</span>
            </div>
          )}

          {pasoActual === 1 && preCompletado && (
            <div
              className="alert-success"
              style={{
                marginBottom: 16, padding: '10px 14px',
                background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8,
                color: '#065f46', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span>✅</span>
              <span>Datos pre-completados desde tu portal. Verificá y elegí la póliza si tenés más de una.</span>
            </div>
          )}

          {pasoActual === 1 && (
            <Paso1
              apellido={apellido} setApellido={(v) => { setApellido(v); clearError('apellido') }}
              nombre={nombre} setNombre={(v) => { setNombre(v); clearError('nombre') }}
              dni={dni} setDni={(v) => { setDni(v); clearError('dni') }}
              email={email} setEmail={(v) => { setEmail(v); clearError('email') }}
              telefono={telefono} setTelefono={(v) => { setTelefono(v); clearError('telefono') }}
              numeroPolizaManual={numeroPolizaManual}
              setNumeroPolizaManual={(v) => { setNumeroPolizaManual(v); clearError('numero_poliza') }}
              polizasToken={polizasToken}
              polizaIdSeleccionada={polizaIdSeleccionada}
              setPolizaIdSeleccionada={(id) => { setPolizaIdSeleccionada(id); clearError('poliza') }}
              preCompletado={preCompletado}
              errores={errores}
            />
          )}

          {pasoActual === 2 && (
            <Paso2
              poliza={polizaSeleccionada}
              tiposValidos={tiposValidos}
              tipoSiniestro={tipoSiniestro}
              setTipoSiniestro={(v) => { setTipoSiniestro(v); clearError('tipo_siniestro') }}
              tipoOtroDescripcion={tipoOtroDescripcion}
              setTipoOtroDescripcion={(v) => { setTipoOtroDescripcion(v); clearError('tipo_otro_descripcion') }}
              fechaSiniestro={fechaSiniestro}
              setFechaSiniestro={(v) => { setFechaSiniestro(v); clearError('fecha_siniestro') }}
              horaSiniestro={horaSiniestro} setHoraSiniestro={setHoraSiniestro}
              lugarSiniestro={lugarSiniestro}
              setLugarSiniestro={(v) => { setLugarSiniestro(v); clearError('lugar_siniestro') }}
              localidadSiniestro={localidadSiniestro}
              setLocalidadSiniestro={(v) => { setLocalidadSiniestro(v); clearError('localidad_siniestro') }}
              descripcion={descripcion}
              setDescripcion={(v) => { setDescripcion(v); clearError('descripcion') }}
              today={today}
              errores={errores}
            />
          )}

          {pasoActual === 3 && (
            <Paso3
              tipoRiesgo={tipoRiesgo}
              tipoSiniestro={tipoSiniestro}
              usarBloqueAutoHardcoded={usarBloqueAutomotorHardcoded}
              valoresDinamicos={valoresDinamicos}
              setValoresDinamicos={setValoresDinamicos}
              esAutoMoto={esAutoMoto}
              esHogar={esHogar}
              esVida={esVida}
              esRobo={esRobo}
              conductor={{
                esAsegurado: conductorEsAsegurado, setEsAsegurado: setConductorEsAsegurado,
                nombre: conductorNombre, setNombre: (v) => { setConductorNombre(v); clearError('conductor_nombre') },
                apellido: conductorApellido, setApellido: (v) => { setConductorApellido(v); clearError('conductor_apellido') },
                dni: conductorDni, setDni: (v) => { setConductorDni(v); clearError('conductor_dni') },
                telefono: conductorTelefono, setTelefono: setConductorTelefono,
                relacion: conductorRelacion, setRelacion: setConductorRelacion,
                registro: conductorRegistro, setRegistro: setConductorRegistro,
              }}
              vehiculoEstacionado={vehiculoEstacionado} setVehiculoEstacionado={setVehiculoEstacionado}
              tercero={{
                hubo: huboTercero, setHubo: (v) => {
                  setHuboTercero(v)
                  if (!v) { setTerceroFuga(false); setTerceroCategoria('') }
                  clearError('tercero_nombre'); clearError('tercero_categoria')
                },
                categoria: terceroCategoria,
                setCategoria: (v) => { setTerceroCategoria(v); clearError('tercero_categoria') },
                fuga: terceroFuga, setFuga: setTerceroFuga,
                nombre: terceroNombre, setNombre: (v) => { setTerceroNombre(v); clearError('tercero_nombre') },
                dni: terceroDni, setDni: setTerceroDni,
                telefono: terceroTelefono, setTelefono: setTerceroTelefono,
                compania: terceroCompania, setCompania: setTerceroCompania,
                poliza: terceroPoliza, setPoliza: setTerceroPoliza,
                tipoVehiculo: terceroTipoVehiculo, setTipoVehiculo: setTerceroTipoVehiculo,
                patente: terceroPatente, setPatente: setTerceroPatente,
                marca: terceroMarca, setMarca: setTerceroMarca,
                modelo: terceroModelo, setModelo: setTerceroModelo,
                anio: terceroAnio, setAnio: setTerceroAnio,
                danos: terceroDanos, setDanos: setTerceroDanos,
              }}
              lesionados={{
                hubo: huboLesionados, setHubo: setHuboLesionados,
                detalle: detalleLesiones, setDetalle: (v) => { setDetalleLesiones(v); clearError('detalle_lesiones') },
              }}
              testigos={{
                hubo: huboTestigos,
                setHubo: (v) => {
                  setHuboTestigos(v); clearError('testigos')
                  if (!v) setTestigos([{ nombre: '', telefono: '' }])
                },
                lista: testigos, setLista: setTestigos,
              }}
              danosPropios={danosPropios} setDanosPropios={setDanosPropios}
              hogar={{
                tipoVivienda, setTipoVivienda,
                quePaso, setQuePaso: (v) => { setQuePaso(v); clearError('que_paso') },
                ambienteAfectado, setAmbienteAfectado,
                causaSiniestro, setCausaSiniestro,
              }}
              denunciaPolicial={denunciaPolicial}
              setDenunciaPolicial={(v) => { setDenunciaPolicial(v); clearError('denuncia_policial') }}
              actaPolicial={actaPolicial} setActaPolicial={setActaPolicial}
              docSlots={docSlots} setDocSlots={setDocSlots}
              archivosGenerales={archivosGenerales} setArchivosGenerales={setArchivosGenerales}
              camposCustom={camposCustomActivos}
              valoresCustom={valoresCustom}
              setValorCustom={(key, v) => {
                setValoresCustom(prev => ({ ...prev, [key]: v }))
                clearError(`custom_${key}`)
              }}
              errores={errores}
            />
          )}

          {pasoActual === 4 && (
            <Paso4
              poliza={polizaSeleccionada} numeroPolizaManual={numeroPolizaManual}
              apellido={apellido} nombre={nombre} dni={dni} email={email} telefono={telefono}
              tipoSiniestro={tipoSiniestro} tipoOtroDescripcion={tipoOtroDescripcion}
              fechaSiniestro={fechaSiniestro} horaSiniestro={horaSiniestro}
              lugarSiniestro={lugarSiniestro} localidadSiniestro={localidadSiniestro}
              descripcion={descripcion}
              tipoRiesgo={tipoRiesgo} esAutoMoto={esAutoMoto} esHogar={esHogar}
              conductorEsAsegurado={conductorEsAsegurado}
              conductor={{ nombre: conductorNombre, apellido: conductorApellido, dni: conductorDni, telefono: conductorTelefono, relacion: conductorRelacion, registro: conductorRegistro }}
              vehiculoEstacionado={vehiculoEstacionado}
              huboTercero={huboTercero} terceroFuga={terceroFuga} terceroCategoria={terceroCategoria}
              tercero={{ nombre: terceroNombre, dni: terceroDni, telefono: terceroTelefono, compania: terceroCompania, poliza: terceroPoliza, tipoVehiculo: terceroTipoVehiculo, patente: terceroPatente, marca: terceroMarca, modelo: terceroModelo, anio: terceroAnio, danos: terceroDanos }}
              huboLesionados={huboLesionados} detalleLesiones={detalleLesiones}
              danosPropios={danosPropios}
              huboTestigos={huboTestigos} testigos={testigos}
              tipoVivienda={tipoVivienda} quePaso={quePaso} ambienteAfectado={ambienteAfectado} causaSiniestro={causaSiniestro}
              denunciaPolicial={denunciaPolicial} actaPolicial={actaPolicial}
              docSlots={docSlots} archivosGenerales={archivosGenerales}
              declaracion={declaracion} setDeclaracion={setDeclaracion}
              config={config}
              aceptaTerminos={aceptaTerminos} setAceptaTerminos={setAceptaTerminos}
              mostrarTerminos={mostrarTerminos} setMostrarTerminos={setMostrarTerminos}
            />
          )}

          {/* Honeypot */}
          <div style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
            <label>No completar este campo
              <input type="text" name="website_honeypot" tabIndex={-1} autoComplete="off"
                value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </label>
          </div>

          <div className="form-buttons">
            {pasoActual > 1 ? (
              <button className="btn btn-secondary" onClick={anterior} disabled={enviando}>← Anterior</button>
            ) : <div />}

            {pasoActual < 4 ? (
              <button className="btn btn-primary" onClick={siguiente} disabled={validandoCliente}>
                {validandoCliente ? <><span className="spinner-inline" /> Validando...</> : <>Siguiente →</>}
              </button>
            ) : (
              <button
                className="btn btn-success btn-lg"
                onClick={enviarDenuncia}
                disabled={enviando || !declaracion || (config?.terminos_activos && !aceptaTerminos)}
              >
                {enviando ? <><span className="spinner-inline" /> Enviando...</> : <>Enviar denuncia</>}
              </button>
            )}
          </div>
        </div>
        {/* Powered by FidCore (solo modo VPS/SaaS-managed) */}
        <div style={{ marginTop: 16, marginBottom: 24 }}>
          <PoweredByFidCore align="center" />
        </div>
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════
//   SUB-COMPONENTES: TOPBAR + PROGRESS
// ════════════════════════════════════════════════════════════

function TopBar({ organizacion }: { organizacion: Organizacion | null }) {
  return (
    <div className="topbar">
      {organizacion?.logo_url ? (
        <img src={organizacion.logo_url} alt="" className="topbar-logo" />
      ) : (
        <div className="topbar-logo-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
      )}
      <span className="topbar-name">{organizacion?.nombre || ''}</span>
    </div>
  )
}

function ProgressBar({ pasoActual }: { pasoActual: number }) {
  return (
    <div className="progress-bar">
      {PASOS.map((label, i) => {
        const step = i + 1
        const isActive = step === pasoActual
        const isCompleted = step < pasoActual
        return (
          <div key={step} style={{ display: 'contents' }}>
            {i > 0 && <div className={`progress-line ${isCompleted ? 'completed' : ''}`} />}
            <div className="progress-step">
              <div className={`progress-dot ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                {isCompleted ? '✓' : step}
              </div>
              <span className={`progress-label ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
//   PASO 1 — Asegurado y póliza
// ════════════════════════════════════════════════════════════

function Paso1({
  apellido, setApellido, nombre, setNombre, dni, setDni, email, setEmail, telefono, setTelefono,
  numeroPolizaManual, setNumeroPolizaManual,
  polizasToken, polizaIdSeleccionada, setPolizaIdSeleccionada,
  preCompletado, errores,
}: {
  apellido: string; setApellido: (v: string) => void
  nombre: string; setNombre: (v: string) => void
  dni: string; setDni: (v: string) => void
  email: string; setEmail: (v: string) => void
  telefono: string; setTelefono: (v: string) => void
  numeroPolizaManual: string; setNumeroPolizaManual: (v: string) => void
  polizasToken: PolizaDisponible[]
  polizaIdSeleccionada: string | null; setPolizaIdSeleccionada: (id: string) => void
  preCompletado: boolean
  errores: Record<string, string>
}) {
  return (
    <>
      <h2 className="form-card-title">Tus datos</h2>
      <p className="form-card-subtitle">Ingresá tus datos personales tal como figuran en la póliza.</p>
      <div className="form-grid">
        <FormField label="Apellido" required error={errores.apellido}>
          <input className={`form-input uppercase ${errores.apellido ? 'error' : ''}`}
            value={apellido} onChange={e => setApellido(e.target.value)} placeholder="PEREZ" />
        </FormField>
        <FormField label="Nombre" required error={errores.nombre}>
          <input className={`form-input uppercase ${errores.nombre ? 'error' : ''}`}
            value={nombre} onChange={e => setNombre(e.target.value)} placeholder="JUAN" />
        </FormField>
        <FormField label="DNI / CUIT" required error={errores.dni}>
          <input className={`form-input ${errores.dni ? 'error' : ''}`}
            value={dni} onChange={e => setDni(e.target.value)} placeholder="12345678" />
        </FormField>
        <FormField label="Email" required error={errores.email}>
          <input type="email" className={`form-input ${errores.email ? 'error' : ''}`}
            value={email} onChange={e => setEmail(e.target.value)} placeholder="email@ejemplo.com" />
        </FormField>
        <FormField label="Teléfono" required error={errores.telefono} className="full-width">
          <input type="tel" className={`form-input ${errores.telefono ? 'error' : ''}`}
            value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="11-1234-5678" />
        </FormField>
      </div>

      {/* Selector de póliza */}
      <h2 className="form-card-title" style={{ marginTop: 24 }}>Tu póliza</h2>
      {preCompletado && polizasToken.length > 0 ? (
        <>
          <p className="form-card-subtitle">
            {polizasToken.length === 1
              ? 'Esta es la póliza sobre la que estás denunciando:'
              : 'Elegí cuál de tus pólizas sufrió el siniestro:'}
          </p>
          {errores.poliza && <div className="form-error" style={{ marginBottom: 8 }}>{errores.poliza}</div>}
          <div className="poliza-cards">
            {polizasToken.map(p => {
              const sel = polizaIdSeleccionada === p.id
              const icono = p.tipo_riesgo === 'automotor' ? '🚗'
                : p.tipo_riesgo === 'moto' ? '🛵'
                : p.tipo_riesgo === 'hogar' ? '🏠'
                : p.tipo_riesgo === 'vida' ? '❤️' : '🛡️'
              return (
                <div
                  key={p.id}
                  className={`poliza-card ${sel ? 'selected' : ''}`}
                  onClick={() => setPolizaIdSeleccionada(p.id)}
                >
                  <div className="poliza-card-icon">{icono}</div>
                  <div className="poliza-card-body">
                    <div className="poliza-card-numero">{p.numero_poliza}</div>
                    <div className="poliza-card-meta">
                      {p.ramo}{p.compania ? ` · ${p.compania}` : ''}
                    </div>
                    {p.riesgo_resumen && <div className="poliza-card-resumen">{p.riesgo_resumen}</div>}
                  </div>
                  <div className="poliza-card-radio">
                    {sel && <span className="poliza-card-radio-dot" />}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <p className="form-card-subtitle">Indicá el número de póliza que figura en tu documentación.</p>
          <div className="form-grid">
            <FormField label="Número de póliza" required error={errores.numero_poliza} className="full-width">
              <input className={`form-input ${errores.numero_poliza ? 'error' : ''}`}
                value={numeroPolizaManual}
                onChange={e => setNumeroPolizaManual(e.target.value)}
                placeholder="01-05-..." />
            </FormField>
          </div>
        </>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════
//   PASO 2 — Datos del siniestro
// ════════════════════════════════════════════════════════════

function Paso2({
  poliza, tiposValidos, tipoSiniestro, setTipoSiniestro, tipoOtroDescripcion, setTipoOtroDescripcion,
  fechaSiniestro, setFechaSiniestro, horaSiniestro, setHoraSiniestro,
  lugarSiniestro, setLugarSiniestro, localidadSiniestro, setLocalidadSiniestro,
  descripcion, setDescripcion,
  today, errores,
}: {
  poliza: PolizaDisponible | null
  tiposValidos: Array<{ id: string; label: string; icon: string }>
  tipoSiniestro: string; setTipoSiniestro: (v: string) => void
  tipoOtroDescripcion: string; setTipoOtroDescripcion: (v: string) => void
  fechaSiniestro: string; setFechaSiniestro: (v: string) => void
  horaSiniestro: string; setHoraSiniestro: (v: string) => void
  lugarSiniestro: string; setLugarSiniestro: (v: string) => void
  localidadSiniestro: string; setLocalidadSiniestro: (v: string) => void
  descripcion: string; setDescripcion: (v: string) => void
  today: string
  errores: Record<string, string>
}) {
  return (
    <>
      <h2 className="form-card-title">Datos del siniestro</h2>
      <p className="form-card-subtitle">Indicá qué tipo de siniestro ocurrió y cuándo.</p>

      {/* Banner read-only de la póliza */}
      {poliza && (
        <div className="poliza-banner">
          <div className="poliza-banner-icon">📄</div>
          <div className="poliza-banner-body">
            <div className="poliza-banner-row">
              <span className="poliza-banner-label">Póliza</span>
              <span className="poliza-banner-value">{poliza.numero_poliza}</span>
            </div>
            <div className="poliza-banner-row">
              <span className="poliza-banner-label">Compañía</span>
              <span className="poliza-banner-value">{poliza.compania || '—'}</span>
            </div>
            <div className="poliza-banner-row">
              <span className="poliza-banner-label">Ramo</span>
              <span className="poliza-banner-value">{poliza.ramo || '—'}</span>
            </div>
            {poliza.riesgo_resumen && (
              <div className="poliza-banner-row">
                <span className="poliza-banner-label">Bien aseg.</span>
                <span className="poliza-banner-value">{poliza.riesgo_resumen}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {errores.tipo_siniestro && <div className="form-error" style={{ marginBottom: 8 }}>{errores.tipo_siniestro}</div>}
      <div className="type-grid">
        {tiposValidos.map(t => (
          <div key={t.id}
            className={`type-card ${tipoSiniestro === t.id ? 'selected' : ''}`}
            onClick={() => setTipoSiniestro(t.id)}>
            <span className="type-card-icon">{t.icon}</span>
            <span className="type-card-label">{t.label}</span>
          </div>
        ))}
      </div>

      {tipoSiniestro === 'OTRO' && (
        <div className="form-group" style={{ marginBottom: 20 }}>
          <label className="form-label">Especificá el tipo <span className="required">*</span></label>
          <input type="text" className={`form-input ${errores.tipo_otro_descripcion ? 'error' : ''}`}
            value={tipoOtroDescripcion} onChange={e => setTipoOtroDescripcion(e.target.value)}
            placeholder="Ej: Choque con animal en ruta" maxLength={120} />
          {errores.tipo_otro_descripcion && <div className="form-error">{errores.tipo_otro_descripcion}</div>}
        </div>
      )}

      <div className="form-grid">
        <FormField label="Fecha del siniestro" required error={errores.fecha_siniestro}>
          <input type="date" className={`form-input ${errores.fecha_siniestro ? 'error' : ''}`}
            value={fechaSiniestro} onChange={e => setFechaSiniestro(e.target.value)} max={today} />
        </FormField>
        <FormField label="Hora del siniestro">
          <input type="time" className="form-input" value={horaSiniestro}
            onChange={e => setHoraSiniestro(e.target.value)} />
        </FormField>
        <FormField label="Lugar del siniestro" required error={errores.lugar_siniestro}>
          <input className={`form-input ${errores.lugar_siniestro ? 'error' : ''}`}
            value={lugarSiniestro} onChange={e => setLugarSiniestro(e.target.value)}
            placeholder="Av. Rivadavia y Carabobo" />
        </FormField>
        <FormField label="Localidad" required error={errores.localidad_siniestro} className="full-width">
          <input className={`form-input ${errores.localidad_siniestro ? 'error' : ''}`}
            value={localidadSiniestro} onChange={e => setLocalidadSiniestro(e.target.value)}
            placeholder="Ciudad de Buenos Aires" />
        </FormField>
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label className="form-label">Relato de los hechos <span className="required">*</span></label>
        <textarea className={`form-textarea ${errores.descripcion ? 'error' : ''}`}
          value={descripcion} onChange={e => setDescripcion(e.target.value)}
          placeholder="Describí con el mayor detalle posible qué ocurrió, cómo, dónde y cuándo..." rows={5} />
        <div className="char-count">{descripcion.length} caracteres (mín. 20)</div>
        {errores.descripcion && <div className="form-error">{errores.descripcion}</div>}
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════
//   PASO 3 — Detalles + Documentación (dinámico por ramo)
// ════════════════════════════════════════════════════════════

interface ConductorProps {
  esAsegurado: boolean; setEsAsegurado: (v: boolean) => void
  nombre: string; setNombre: (v: string) => void
  apellido: string; setApellido: (v: string) => void
  dni: string; setDni: (v: string) => void
  telefono: string; setTelefono: (v: string) => void
  relacion: string; setRelacion: (v: string) => void
  registro: string; setRegistro: (v: string) => void
}

interface TerceroProps {
  hubo: boolean; setHubo: (v: boolean) => void
  categoria: CategoriaInvolucrado | ''
  setCategoria: (v: CategoriaInvolucrado | '') => void
  fuga: boolean; setFuga: (v: boolean) => void
  nombre: string; setNombre: (v: string) => void
  dni: string; setDni: (v: string) => void
  telefono: string; setTelefono: (v: string) => void
  compania: string; setCompania: (v: string) => void
  poliza: string; setPoliza: (v: string) => void
  tipoVehiculo: string; setTipoVehiculo: (v: string) => void
  patente: string; setPatente: (v: string) => void
  marca: string; setMarca: (v: string) => void
  modelo: string; setModelo: (v: string) => void
  anio: string; setAnio: (v: string) => void
  danos: string; setDanos: (v: string) => void
}

interface LesionadosProps {
  hubo: boolean; setHubo: (v: boolean) => void
  detalle: string; setDetalle: (v: string) => void
}

interface TestigosProps {
  hubo: boolean; setHubo: (v: boolean) => void
  lista: TestigoData[]; setLista: (v: TestigoData[] | ((prev: TestigoData[]) => TestigoData[])) => void
}

interface HogarProps {
  tipoVivienda: string; setTipoVivienda: (v: string) => void
  quePaso: string; setQuePaso: (v: string) => void
  ambienteAfectado: string; setAmbienteAfectado: (v: string) => void
  causaSiniestro: string; setCausaSiniestro: (v: string) => void
}

function Paso3({
  tipoRiesgo, tipoSiniestro, usarBloqueAutoHardcoded,
  valoresDinamicos, setValoresDinamicos,
  esAutoMoto, esHogar, esVida, esRobo,
  conductor, vehiculoEstacionado, setVehiculoEstacionado,
  tercero, lesionados, testigos, danosPropios, setDanosPropios,
  hogar,
  denunciaPolicial, setDenunciaPolicial, actaPolicial, setActaPolicial,
  docSlots, setDocSlots, archivosGenerales, setArchivosGenerales,
  camposCustom, valoresCustom, setValorCustom,
  errores,
}: {
  tipoRiesgo: TipoRiesgoSiniestro
  tipoSiniestro: string
  usarBloqueAutoHardcoded: boolean
  valoresDinamicos: ValoresDinamicos
  setValoresDinamicos: (v: ValoresDinamicos) => void
  esAutoMoto: boolean; esHogar: boolean; esVida: boolean; esRobo: boolean
  conductor: ConductorProps
  vehiculoEstacionado: 'si' | 'no' | ''
  setVehiculoEstacionado: (v: 'si' | 'no' | '') => void
  tercero: TerceroProps
  lesionados: LesionadosProps
  testigos: TestigosProps
  danosPropios: string; setDanosPropios: (v: string) => void
  hogar: HogarProps
  denunciaPolicial: 'si' | 'no' | ''
  setDenunciaPolicial: (v: 'si' | 'no' | '') => void
  actaPolicial: string; setActaPolicial: (v: string) => void
  docSlots: DocSlots
  setDocSlots: (fn: (prev: DocSlots) => DocSlots) => void
  archivosGenerales: File[]
  setArchivosGenerales: (fn: (prev: File[]) => File[]) => void
  camposCustom: Array<{ key: string; label: string; tipo: string; requerido?: boolean; placeholder?: string; opciones?: string }>
  valoresCustom: Record<string, string>
  setValorCustom: (key: string, v: string) => void
  errores: Record<string, string>
}) {
  return (
    <>
      <h2 className="form-card-title">Detalles del siniestro</h2>
      <p className="form-card-subtitle">Completá los datos específicos según corresponda.</p>

      {/* ═════ CONDUCTOR (auto/moto — solo ACCIDENTE_TRANSITO) ═════ */}
      {usarBloqueAutoHardcoded && (
        <SectionCard icon="👤" title="Conductor del vehículo">
          <div className="toggle-pregunta">
            <div className="toggle-pregunta-label">¿El conductor era el asegurado?</div>
            <div className="toggle-pregunta-opciones">
              <button type="button"
                className={`toggle-btn ${conductor.esAsegurado ? 'active' : ''}`}
                onClick={() => conductor.setEsAsegurado(true)}>Sí</button>
              <button type="button"
                className={`toggle-btn ${!conductor.esAsegurado ? 'active' : ''}`}
                onClick={() => conductor.setEsAsegurado(false)}>No</button>
            </div>
          </div>

          {!conductor.esAsegurado && (
            <div className="form-grid" style={{ marginTop: 16 }}>
              <FormField label="Apellido del conductor" required error={errores.conductor_apellido}>
                <input className={`form-input uppercase ${errores.conductor_apellido ? 'error' : ''}`}
                  value={conductor.apellido} onChange={e => conductor.setApellido(e.target.value)} />
              </FormField>
              <FormField label="Nombre del conductor" required error={errores.conductor_nombre}>
                <input className={`form-input uppercase ${errores.conductor_nombre ? 'error' : ''}`}
                  value={conductor.nombre} onChange={e => conductor.setNombre(e.target.value)} />
              </FormField>
              <FormField label="DNI" required error={errores.conductor_dni}>
                <input className={`form-input ${errores.conductor_dni ? 'error' : ''}`}
                  value={conductor.dni} onChange={e => conductor.setDni(e.target.value)} placeholder="12345678" />
              </FormField>
              <FormField label="Teléfono">
                <input type="tel" className="form-input"
                  value={conductor.telefono} onChange={e => conductor.setTelefono(e.target.value)} />
              </FormField>
              <FormField label="Relación con el asegurado">
                <select className="form-input" value={conductor.relacion}
                  onChange={e => conductor.setRelacion(e.target.value)}>
                  <option value="">— Seleccioná —</option>
                  {RELACIONES_CONDUCTOR.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </FormField>
              <FormField label="Nro. registro de conducir">
                <input className="form-input"
                  value={conductor.registro} onChange={e => conductor.setRegistro(e.target.value)} />
              </FormField>
            </div>
          )}
        </SectionCard>
      )}

      {/* ═════ ¿VEHÍCULO ESTACIONADO? (auto/moto — solo ACCIDENTE_TRANSITO) ═════ */}
      {usarBloqueAutoHardcoded && (
        <SectionCard icon="🅿️" title="¿El vehículo estaba estacionado?">
          <p style={{ fontSize: 13, color: '#64748b', marginTop: -4, marginBottom: 12 }}>
            Indicá si al momento del siniestro el vehículo estaba detenido y estacionado.
          </p>
          <div className="toggle-pregunta">
            <div className="toggle-pregunta-opciones">
              <button type="button"
                className={`toggle-btn ${vehiculoEstacionado === 'si' ? 'active' : ''}`}
                onClick={() => setVehiculoEstacionado('si')}>Sí, estaba estacionado</button>
              <button type="button"
                className={`toggle-btn ${vehiculoEstacionado === 'no' ? 'active' : ''}`}
                onClick={() => setVehiculoEstacionado('no')}>No, estaba en circulación</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ═════ DAÑOS PROPIOS (auto/moto — solo ACCIDENTE_TRANSITO) ═════ */}
      {usarBloqueAutoHardcoded && (
        <SectionCard icon="🔧" title="Daños del vehículo asegurado">
          <div className="form-group">
            <label className="form-label">Describí los daños</label>
            <textarea className="form-textarea" rows={3}
              value={danosPropios} onChange={e => setDanosPropios(e.target.value)}
              placeholder="Ej: Abolladura en el paragolpes delantero, faro derecho roto, capot deformado..." />
          </div>
        </SectionCard>
      )}

      {/* ═════ OTRA PERSONA O VEHÍCULO INVOLUCRADO (auto/moto — solo ACCIDENTE_TRANSITO) ═════ */}
      {usarBloqueAutoHardcoded && (
        <SectionCard icon="🚙" title="¿Otra persona o vehículo involucrado?">
          <p style={{ fontSize: 13, color: '#64748b', marginTop: -4, marginBottom: 12 }}>
            Marcá "Sí" si chocaste con otro vehículo, peatón o algún objeto, o si hay otra persona afectada.
          </p>
          <div className="toggle-pregunta">
            <div className="toggle-pregunta-opciones">
              <button type="button"
                className={`toggle-btn ${tercero.hubo ? 'active' : ''}`}
                onClick={() => tercero.setHubo(true)}>Sí</button>
              <button type="button"
                className={`toggle-btn ${!tercero.hubo ? 'active' : ''}`}
                onClick={() => tercero.setHubo(false)}>No</button>
            </div>
          </div>

          {tercero.hubo && (
            <>
              {/* Selector de categoría */}
              <div style={{ marginTop: 16 }}>
                <label className="form-label">¿Con qué o con quién? <span className="required">*</span></label>
                {errores.tercero_categoria && <div className="form-error" style={{ marginBottom: 8 }}>{errores.tercero_categoria}</div>}
                <div className="type-grid" style={{ marginTop: 8 }}>
                  {CATEGORIAS_INVOLUCRADO.map(cat => (
                    <div key={cat.value}
                      className={`type-card ${tercero.categoria === cat.value ? 'selected' : ''}`}
                      onClick={() => tercero.setCategoria(cat.value)}>
                      <span className="type-card-icon">{cat.icon}</span>
                      <span className="type-card-label">{cat.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {tercero.categoria && (
                <>
                  <div className="checkbox-mini" style={{ marginTop: 16 }}>
                    <label className="checkbox-mini-label">
                      <input type="checkbox" checked={tercero.fuga}
                        onChange={e => tercero.setFuga(e.target.checked)} />
                      <span>No cuento con los datos (se dio a la fuga / no se identificó)</span>
                    </label>
                  </div>

                  {!tercero.fuga && (
                    <div className="form-grid" style={{ marginTop: 16 }}>
                      {/* Datos personales: aplican a vehículo, moto, bici, peatón, persona, otro.
                          Para objeto fijo no se piden. */}
                      {tercero.categoria !== 'objeto_fijo' && (
                        <>
                          <FormField label="Nombre y apellido" required error={errores.tercero_nombre}>
                            <input className={`form-input ${errores.tercero_nombre ? 'error' : ''}`}
                              value={tercero.nombre} onChange={e => tercero.setNombre(e.target.value)} />
                          </FormField>
                          <FormField label="DNI">
                            <input className="form-input" value={tercero.dni}
                              onChange={e => tercero.setDni(e.target.value)} placeholder="12345678" />
                          </FormField>
                          <FormField label="Teléfono">
                            <input type="tel" className="form-input" value={tercero.telefono}
                              onChange={e => tercero.setTelefono(e.target.value)} />
                          </FormField>
                        </>
                      )}

                      {/* Datos de seguro: aplican a vehículo y moto */}
                      {(tercero.categoria === 'vehiculo' || tercero.categoria === 'moto') && (
                        <>
                          <FormField label="Compañía aseguradora del otro vehículo">
                            <input className="form-input" value={tercero.compania}
                              onChange={e => tercero.setCompania(e.target.value)} placeholder="Ej: La Caja" />
                          </FormField>
                          <FormField label="Nro. póliza del otro vehículo" className="full-width">
                            <input className="form-input" value={tercero.poliza}
                              onChange={e => tercero.setPoliza(e.target.value)} />
                          </FormField>
                        </>
                      )}

                      {/* Datos del vehículo: aplican a vehículo, moto, bici */}
                      {CATEGORIAS_CON_VEHICULO.has(tercero.categoria) && (
                        <>
                          {tercero.categoria !== 'bici' && (
                            <FormField label="Patente">
                              <input className="form-input uppercase" value={tercero.patente}
                                onChange={e => tercero.setPatente(e.target.value)} placeholder="AB123CD" />
                            </FormField>
                          )}
                          <FormField label="Marca">
                            <input className="form-input" value={tercero.marca}
                              onChange={e => tercero.setMarca(e.target.value)} />
                          </FormField>
                          <FormField label="Modelo">
                            <input className="form-input" value={tercero.modelo}
                              onChange={e => tercero.setModelo(e.target.value)} />
                          </FormField>
                          {tercero.categoria !== 'bici' && (
                            <FormField label="Año">
                              <input className="form-input" inputMode="numeric" maxLength={4} value={tercero.anio}
                                onChange={e => tercero.setAnio(e.target.value.replace(/\D/g, ''))} />
                            </FormField>
                          )}
                        </>
                      )}

                      {/* Descripción de daños — aplica a todos */}
                      <FormField
                        label={tercero.categoria === 'objeto_fijo'
                          ? 'Descripción del objeto y los daños'
                          : 'Descripción de los daños del tercero'}
                        className="full-width">
                        <textarea className="form-textarea" rows={2} value={tercero.danos}
                          onChange={e => tercero.setDanos(e.target.value)}
                          placeholder={tercero.categoria === 'objeto_fijo'
                            ? 'Ej: Choqué contra un poste de luz en la esquina, quedó inclinado...'
                            : 'Describí los daños sufridos por el otro vehículo o persona...'} />
                      </FormField>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </SectionCard>
      )}

      {/* ═════ LESIONADOS (auto/moto — solo ACCIDENTE_TRANSITO) ═════ */}
      {usarBloqueAutoHardcoded && (
        <SectionCard icon="🏥" title="Lesionados">
          <div className="toggle-pregunta">
            <div className="toggle-pregunta-label">¿Hubo personas lesionadas?</div>
            <div className="toggle-pregunta-opciones">
              <button type="button"
                className={`toggle-btn ${lesionados.hubo ? 'active' : ''}`}
                onClick={() => lesionados.setHubo(true)}>Sí</button>
              <button type="button"
                className={`toggle-btn ${!lesionados.hubo ? 'active' : ''}`}
                onClick={() => lesionados.setHubo(false)}>No</button>
            </div>
          </div>
          {lesionados.hubo && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Detalle de las lesiones <span className="required">*</span></label>
              <textarea className={`form-textarea ${errores.detalle_lesiones ? 'error' : ''}`}
                rows={3}
                value={lesionados.detalle} onChange={e => lesionados.setDetalle(e.target.value)}
                placeholder="¿Quién resultó lesionado? ¿Qué tipo de lesiones? ¿Recibió atención médica?" />
              {errores.detalle_lesiones && <div className="form-error">{errores.detalle_lesiones}</div>}
            </div>
          )}
        </SectionCard>
      )}

      {/* ═════ TESTIGOS (todos los ramos) ═════ */}
      <SectionCard icon="👥" title="Testigos">
        <div className="toggle-pregunta">
          <div className="toggle-pregunta-label">¿Hubo testigos del hecho?</div>
          <div className="toggle-pregunta-opciones">
            <button type="button"
              className={`toggle-btn ${testigos.hubo ? 'active' : ''}`}
              onClick={() => testigos.setHubo(true)}>Sí</button>
            <button type="button"
              className={`toggle-btn ${!testigos.hubo ? 'active' : ''}`}
              onClick={() => testigos.setHubo(false)}>No</button>
          </div>
        </div>
        {errores.testigos && <div className="form-error" style={{ marginTop: 8 }}>{errores.testigos}</div>}
        {testigos.hubo && (
          <div style={{ marginTop: 16 }}>
            {testigos.lista.map((t, idx) => (
              <div key={idx} className="testigo-row">
                <FormField label={`Testigo ${idx + 1} — Nombre y apellido`}>
                  <input className="form-input" value={t.nombre}
                    onChange={e => testigos.setLista(testigos.lista.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))} />
                </FormField>
                <FormField label="Teléfono">
                  <input type="tel" className="form-input" value={t.telefono}
                    onChange={e => testigos.setLista(testigos.lista.map((x, i) => i === idx ? { ...x, telefono: e.target.value } : x))} />
                </FormField>
                {testigos.lista.length > 1 && (
                  <button type="button" className="testigo-remove"
                    onClick={() => testigos.setLista(testigos.lista.filter((_, i) => i !== idx))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {testigos.lista.length < MAX_TESTIGOS && (
              <button type="button" className="btn btn-secondary"
                style={{ marginTop: 8, fontSize: 13 }}
                onClick={() => testigos.setLista([...testigos.lista, { nombre: '', telefono: '' }])}>
                + Agregar otro testigo
              </button>
            )}
          </div>
        )}
      </SectionCard>

      {/* ═════ CAMPOS DINÁMICOS (para tipos que no son ACCIDENTE_TRANSITO) ═════ */}
      {tipoSiniestro && !usarBloqueAutoHardcoded && (() => {
        const configTipo = obtenerConfigTipoSiniestro(tipoRiesgo, tipoSiniestro)
        if (!configTipo || (configTipo.bloques.length === 0 && configTipo.campos.length === 0)) return null
        return (
          <SectionCard icon={configTipo.icono ?? '📋'} title={`Datos de ${configTipo.label.toLowerCase()}`}>
            <CamposDinamicos
              tipoRiesgo={tipoRiesgo}
              tipoSiniestro={tipoSiniestro}
              valores={valoresDinamicos}
              onChange={setValoresDinamicos}
              errores={errores}
            />
          </SectionCard>
        )
      })()}

      {/* ═════ HOGAR ═════ */}
      {esHogar && (
        <SectionCard icon="🏠" title="Datos del inmueble">
          <div className="form-grid">
            <FormField label="Tipo de vivienda">
              <select className="form-input" value={hogar.tipoVivienda}
                onChange={e => hogar.setTipoVivienda(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {TIPOS_VIVIENDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FormField>
            <FormField label="¿Qué pasó?" required error={errores.que_paso}>
              <select className={`form-input ${errores.que_paso ? 'error' : ''}`}
                value={hogar.quePaso} onChange={e => hogar.setQuePaso(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {QUE_PASO_HOGAR.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FormField>
            <FormField label="Ambiente afectado">
              <input className="form-input" value={hogar.ambienteAfectado}
                onChange={e => hogar.setAmbienteAfectado(e.target.value)}
                placeholder="Cocina, baño, living..." />
            </FormField>
            <FormField label="Causa del siniestro">
              <input className="form-input" value={hogar.causaSiniestro}
                onChange={e => hogar.setCausaSiniestro(e.target.value)}
                placeholder="Cañería rota, cortocircuito..." />
            </FormField>
          </div>
        </SectionCard>
      )}

      {/* ═════ DENUNCIA POLICIAL ═════ */}
      <SectionCard icon="🚓" title="Denuncia policial">
        <div className="form-group">
          <label className="form-label">
            ¿Hubo denuncia policial? {esRobo && <span className="required">*</span>}
          </label>
          {errores.denuncia_policial && <div className="form-error">{errores.denuncia_policial}</div>}
          <div className="radio-group" style={{ marginTop: 8 }}>
            <label
              className={`radio-option ${denunciaPolicial === 'si' ? 'selected' : ''}`}
              onClick={() => setDenunciaPolicial('si')}>
              <input type="radio" name="denuncia_policial" value="si"
                checked={denunciaPolicial === 'si'} readOnly />
              <span className="radio-dot"><span className="radio-dot-inner" /></span>
              Sí, hice denuncia policial
            </label>
            <label
              className={`radio-option ${denunciaPolicial === 'no' ? 'selected' : ''}`}
              onClick={() => { setDenunciaPolicial('no'); setActaPolicial('') }}>
              <input type="radio" name="denuncia_policial" value="no"
                checked={denunciaPolicial === 'no'} readOnly />
              <span className="radio-dot"><span className="radio-dot-inner" /></span>
              No
            </label>
          </div>
        </div>

        {denunciaPolicial === 'si' && (
          <FormField label="Nro. de acta policial (opcional)" className="full-width">
            <input className="form-input" value={actaPolicial}
              onChange={e => setActaPolicial(e.target.value)}
              placeholder="Ej: 12345/2026" />
          </FormField>
        )}
      </SectionCard>

      {/* ═════ DOCUMENTACIÓN ═════ */}
      <h2 className="form-card-title" style={{ marginTop: 24 }}>Documentación</h2>
      {esAutoMoto && (
        <p className="form-card-subtitle">
          Subí <strong>frente y dorso</strong> de cada documento. Estos archivos son <strong>obligatorios</strong>.
        </p>
      )}
      {!esAutoMoto && (
        <p className="form-card-subtitle">
          Subí <strong>frente y dorso</strong> del DNI del titular. Después podés sumar fotos y documentación que respalden tu denuncia.
        </p>
      )}

      {esAutoMoto ? (
        <>
          <div className="docs-grid">
            {DOCS_AUTO.map(doc => (
              <DocFrenteDorsoCard
                key={doc.id}
                docId={doc.id}
                label={doc.label}
                icon={doc.icon}
                slots={docSlots}
                setSlots={setDocSlots}
                errores={errores}
              />
            ))}
          </div>

          {/* Denuncia policial: si dijo SÍ, slot disponible (obligatorio si es robo). */}
          {denunciaPolicial === 'si' && (
            <div className="docs-grid" style={{ marginTop: 16 }}>
              <DocSimpleCard
                slotId="denuncia_policial"
                label="Denuncia policial"
                icon="📝"
                required={esRobo}
                slots={docSlots}
                setSlots={setDocSlots}
                error={!!errores.doc_denuncia_policial}
                hint={esRobo ? 'Obligatoria en caso de robo' : 'Subí la copia de la denuncia'}
              />
            </div>
          )}
        </>
      ) : (
        <>
          {/* DNI del titular: obligatorio para todos los ramos no-auto/moto */}
          <div className="docs-grid">
            {DOCS_NO_AUTO.map(doc => (
              <DocFrenteDorsoCard
                key={doc.id}
                docId={doc.id}
                label={doc.label}
                icon={doc.icon}
                slots={docSlots}
                setSlots={setDocSlots}
                errores={errores}
              />
            ))}
          </div>

          {/* Denuncia policial: aparece si dijo SÍ (obligatoria si es robo). */}
          {denunciaPolicial === 'si' && (
            <div className="docs-grid" style={{ marginTop: 16 }}>
              <DocSimpleCard
                slotId="denuncia_policial"
                label="Denuncia policial"
                icon="📝"
                required={esRobo}
                slots={docSlots}
                setSlots={setDocSlots}
                error={!!errores.doc_denuncia_policial}
                hint={esRobo ? 'Obligatoria en caso de robo' : 'Subí la copia de la denuncia'}
              />
            </div>
          )}
        </>
      )}

      {/* Campos custom configurados por el PAS en el catálogo del ramo.
          Aparecen solo si el PAS los definió. Cada campo respeta su tipo
          (text/textarea/select/date), placeholder, opciones y requerido. */}
      {camposCustom.length > 0 && (
        <SectionCard icon="📋" title="Información adicional">
          <div className="form-grid">
            {camposCustom.map((c) => {
              const valor = valoresCustom[c.key] || ''
              const err = errores[`custom_${c.key}`]
              const inputClass = `form-input${err ? ' error' : ''}`
              return (
                <FormField key={c.key} label={c.label} required={c.requerido} error={err}>
                  {c.tipo === 'textarea' ? (
                    <textarea className={inputClass} rows={3} value={valor} placeholder={c.placeholder}
                      onChange={e => setValorCustom(c.key, e.target.value)} />
                  ) : c.tipo === 'select' ? (
                    <select className={inputClass} value={valor} onChange={e => setValorCustom(c.key, e.target.value)}>
                      <option value="">— Seleccioná —</option>
                      {(c.opciones || '').split(',').map(s => s.trim()).filter(Boolean).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : c.tipo === 'date' ? (
                    <input type="date" className={inputClass} value={valor}
                      onChange={e => setValorCustom(c.key, e.target.value)} />
                  ) : (
                    <input type="text" className={inputClass} value={valor} placeholder={c.placeholder}
                      onChange={e => setValorCustom(c.key, e.target.value)} />
                  )}
                </FormField>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Subida libre — disponible para todos los ramos */}
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-marca, #0A1628)', marginTop: 20, marginBottom: 8 }}>
        Otras fotos y documentación
      </h3>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
        Aunque no es obligatorio, <strong>todo lo que puedas aportar ayuda a tu denuncia</strong>.
        Sumá lo que tengas: <strong>fotos del lugar y de los daños</strong>, fotos del DNI / seguro / patente del tercero,
        partes médicos, presupuestos del taller o cualquier documentación relevante.
      </p>
      <GeneralUpload files={archivosGenerales} onFilesChange={setArchivosGenerales} />
    </>
  )
}

// ════════════════════════════════════════════════════════════
//   PASO 4 — Resumen y envío
// ════════════════════════════════════════════════════════════

function Paso4(props: {
  poliza: PolizaDisponible | null
  numeroPolizaManual: string
  apellido: string; nombre: string; dni: string; email: string; telefono: string
  tipoSiniestro: string; tipoOtroDescripcion: string
  fechaSiniestro: string; horaSiniestro: string
  lugarSiniestro: string; localidadSiniestro: string
  descripcion: string
  tipoRiesgo: TipoRiesgoSiniestro
  esAutoMoto: boolean; esHogar: boolean
  conductorEsAsegurado: boolean
  conductor: { nombre: string; apellido: string; dni: string; telefono: string; relacion: string; registro: string }
  vehiculoEstacionado: 'si' | 'no' | ''
  huboTercero: boolean; terceroFuga: boolean; terceroCategoria: CategoriaInvolucrado | ''
  tercero: { nombre: string; dni: string; telefono: string; compania: string; poliza: string; tipoVehiculo: string; patente: string; marca: string; modelo: string; anio: string; danos: string }
  huboLesionados: boolean; detalleLesiones: string
  danosPropios: string
  huboTestigos: boolean; testigos: TestigoData[]
  tipoVivienda: string; quePaso: string; ambienteAfectado: string; causaSiniestro: string
  denunciaPolicial: string; actaPolicial: string
  docSlots: DocSlots; archivosGenerales: File[]
  declaracion: boolean; setDeclaracion: (v: boolean) => void
  config: FormConfig | null
  aceptaTerminos: boolean; setAceptaTerminos: (v: boolean) => void
  mostrarTerminos: boolean; setMostrarTerminos: (v: boolean) => void
}) {
  const configTipo = obtenerConfigTipoSiniestro(props.tipoRiesgo, props.tipoSiniestro)
  const tipoLabel = configTipo?.label || props.tipoSiniestro
  const totalArchivos =
    Object.values(props.docSlots).reduce((acc, files) => acc + files.length, 0)
    + props.archivosGenerales.length
  const numeroPoliza = props.poliza?.numero_poliza || props.numeroPolizaManual

  const categoriaInvolucradoLabel = props.terceroCategoria
    ? CATEGORIAS_INVOLUCRADO.find(c => c.value === props.terceroCategoria)?.label || props.terceroCategoria
    : ''

  return (
    <>
      <h2 className="form-card-title">Resumen de la denuncia</h2>
      <p className="form-card-subtitle">Verificá que todos los datos sean correctos antes de enviar.</p>

      {/* Banner aclaratorio: precarga + qué pasa después */}
      <div style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 10,
        padding: 14,
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>ℹ️</span>
        <div style={{ fontSize: 13, color: '#1e3a8a', lineHeight: 1.55 }}>
          Esto es una <strong>precarga de la denuncia</strong>: con esta información tu productor va a presentar
          la denuncia formal ante la compañía. Vas a recibir un correo con el <strong>resumen y el PDF de la
          precarga</strong>, igual que tu productor.
        </div>
      </div>

      <div className="summary-section">
        <div className="summary-section-title">👤 Asegurado</div>
        <SummaryRow label="Apellido" value={props.apellido.toUpperCase()} />
        <SummaryRow label="Nombre" value={props.nombre.toUpperCase()} />
        <SummaryRow label="DNI / CUIT" value={props.dni} />
        <SummaryRow label="Email" value={props.email} />
        <SummaryRow label="Teléfono" value={props.telefono} />
      </div>

      <div className="summary-section">
        <div className="summary-section-title">📄 Póliza</div>
        <SummaryRow label="Nro. póliza" value={numeroPoliza} />
        {props.poliza?.compania && <SummaryRow label="Compañía" value={props.poliza.compania} />}
        {props.poliza?.ramo && <SummaryRow label="Ramo" value={props.poliza.ramo} />}
        {props.poliza?.riesgo_resumen && <SummaryRow label="Bien aseg." value={props.poliza.riesgo_resumen} />}
      </div>

      <div className="summary-section">
        <div className="summary-section-title">⚠️ Siniestro</div>
        <SummaryRow label="Tipo" value={tipoLabel} />
        {props.tipoSiniestro === 'OTRO' && props.tipoOtroDescripcion && (
          <SummaryRow label="Detalle tipo" value={props.tipoOtroDescripcion} />
        )}
        <SummaryRow label="Fecha" value={props.fechaSiniestro} />
        {props.horaSiniestro && <SummaryRow label="Hora" value={props.horaSiniestro} />}
        <SummaryRow label="Lugar" value={props.lugarSiniestro} />
        <SummaryRow label="Localidad" value={props.localidadSiniestro} />
      </div>

      <div className="summary-section">
        <div className="summary-section-title">📝 Relato</div>
        <div className="summary-description">
          {props.descripcion.length > 300
            ? props.descripcion.substring(0, 300) + '...'
            : props.descripcion}
        </div>
      </div>

      {props.esAutoMoto && (
        <>
          <div className="summary-section">
            <div className="summary-section-title">🚗 Conductor</div>
            <SummaryRow label="¿Era el asegurado?" value={props.conductorEsAsegurado ? 'Sí' : 'No'} />
            {!props.conductorEsAsegurado && (
              <>
                <SummaryRow label="Nombre" value={`${props.conductor.apellido}, ${props.conductor.nombre}`} />
                <SummaryRow label="DNI" value={props.conductor.dni} />
                {props.conductor.telefono && <SummaryRow label="Teléfono" value={props.conductor.telefono} />}
                {props.conductor.relacion && <SummaryRow label="Relación" value={props.conductor.relacion} />}
                {props.conductor.registro && <SummaryRow label="Registro" value={props.conductor.registro} />}
              </>
            )}
          </div>

          {props.vehiculoEstacionado && (
            <div className="summary-section">
              <div className="summary-section-title">🅿️ ¿Vehículo estacionado?</div>
              <SummaryRow label="Al momento del siniestro" value={props.vehiculoEstacionado === 'si' ? 'Sí, estaba estacionado' : 'No, estaba en circulación'} />
            </div>
          )}

          {props.huboTercero && (
            <div className="summary-section">
              <div className="summary-section-title">🚙 Otra persona / vehículo involucrado</div>
              {categoriaInvolucradoLabel && <SummaryRow label="Tipo" value={categoriaInvolucradoLabel} />}
              {props.terceroFuga ? (
                <SummaryRow label="Estado" value="Se dio a la fuga / no se identificó" />
              ) : (
                <>
                  {props.tercero.nombre && <SummaryRow label="Nombre" value={props.tercero.nombre} />}
                  {props.tercero.dni && <SummaryRow label="DNI" value={props.tercero.dni} />}
                  {props.tercero.telefono && <SummaryRow label="Teléfono" value={props.tercero.telefono} />}
                  {props.tercero.compania && <SummaryRow label="Compañía" value={props.tercero.compania} />}
                  {props.tercero.poliza && <SummaryRow label="Póliza" value={props.tercero.poliza} />}
                  {props.tercero.patente && <SummaryRow label="Patente" value={props.tercero.patente} />}
                  {(props.tercero.marca || props.tercero.modelo) && (
                    <SummaryRow label="Vehículo" value={[props.tercero.marca, props.tercero.modelo, props.tercero.anio].filter(Boolean).join(' ')} />
                  )}
                  {props.tercero.danos && <SummaryRow label="Daños / detalle" value={props.tercero.danos} />}
                </>
              )}
            </div>
          )}

          {props.huboLesionados && (
            <div className="summary-section">
              <div className="summary-section-title">🏥 Lesionados</div>
              <div className="summary-description">{props.detalleLesiones}</div>
            </div>
          )}

          {props.danosPropios && (
            <div className="summary-section">
              <div className="summary-section-title">🔧 Daños propios</div>
              <div className="summary-description">{props.danosPropios}</div>
            </div>
          )}
        </>
      )}

      {props.esHogar && (props.tipoVivienda || props.quePaso || props.ambienteAfectado || props.causaSiniestro) && (
        <div className="summary-section">
          <div className="summary-section-title">🏠 Inmueble</div>
          {props.tipoVivienda && <SummaryRow label="Tipo" value={TIPOS_VIVIENDA.find(t => t.value === props.tipoVivienda)?.label || props.tipoVivienda} />}
          {props.quePaso && <SummaryRow label="¿Qué pasó?" value={QUE_PASO_HOGAR.find(t => t.value === props.quePaso)?.label || props.quePaso} />}
          {props.ambienteAfectado && <SummaryRow label="Ambiente" value={props.ambienteAfectado} />}
          {props.causaSiniestro && <SummaryRow label="Causa" value={props.causaSiniestro} />}
        </div>
      )}

      {props.huboTestigos && props.testigos.some(t => t.nombre || t.telefono) && (
        <div className="summary-section">
          <div className="summary-section-title">👥 Testigos</div>
          {props.testigos.filter(t => t.nombre || t.telefono).map((t, i) => (
            <SummaryRow key={i} label={`Testigo ${i + 1}`} value={`${t.nombre}${t.telefono ? ` · ${t.telefono}` : ''}`} />
          ))}
        </div>
      )}

      {props.denunciaPolicial && (
        <div className="summary-section">
          <div className="summary-section-title">🚓 Denuncia policial</div>
          <SummaryRow label="¿Se hizo?" value={props.denunciaPolicial === 'si' ? 'Sí' : 'No'} />
          {props.actaPolicial && <SummaryRow label="Nro. acta" value={props.actaPolicial} />}
        </div>
      )}

      <div className="summary-section">
        <div className="summary-section-title">📎 Archivos adjuntos</div>
        <SummaryRow label="Total" value={`${totalArchivos} archivo(s)`} />
      </div>

      {props.config?.terminos_activos && props.config.terminos_contenido && (
        <>
          <div className="checkbox-container"
            style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}
            onClick={() => props.setAceptaTerminos(!props.aceptaTerminos)}>
            <div className={`checkbox-box ${props.aceptaTerminos ? 'checked' : ''}`}>
              {props.aceptaTerminos && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <span className="checkbox-text" style={{ color: '#1e40af' }}>
              Acepto los{' '}
              <span style={{ textDecoration: 'underline', cursor: 'pointer' }}
                onClick={e => { e.stopPropagation(); props.setMostrarTerminos(true) }}>
                {props.config.terminos_titulo || 'Términos y Condiciones'}
              </span>
            </span>
          </div>

          {props.mostrarTerminos && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
              alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 16,
            }} onClick={() => props.setMostrarTerminos(false)}>
              <div style={{
                background: 'white', borderRadius: 16, maxWidth: 600, width: '100%',
                maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-marca, #0A1628)', margin: 0 }}>
                    {props.config.terminos_titulo || 'Términos y Condiciones'}
                  </h3>
                  <button onClick={() => props.setMostrarTerminos(false)}
                    style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', padding: '4px 8px' }}>×</button>
                </div>
                <div style={{ padding: 24, overflowY: 'auto', fontSize: 14, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {props.config.terminos_contenido}
                </div>
                <div style={{ padding: '12px 24px', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
                  <button className="btn btn-primary" onClick={() => props.setMostrarTerminos(false)}>Cerrar</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="checkbox-container" onClick={() => props.setDeclaracion(!props.declaracion)}>
        <div className={`checkbox-box ${props.declaracion ? 'checked' : ''}`}>
          {props.declaracion && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <span className="checkbox-text">
          Declaro bajo juramento que la información proporcionada es veraz y completa.
          Entiendo que cualquier falsedad puede tener consecuencias legales.
        </span>
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════
//   HELPERS DE UI
// ════════════════════════════════════════════════════════════

function FormField({ label, required, error, className, children }: {
  label: string; required?: boolean; error?: string; className?: string; children: React.ReactNode
}) {
  return (
    <div className={`form-group ${className || ''}`}>
      <label className="form-label">
        {label}{required && <span className="required">*</span>}
      </label>
      {children}
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
    </div>
  )
}

function SectionCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-icon">{icon}</span>
        <span className="section-card-title">{title}</span>
      </div>
      <div className="section-card-body">{children}</div>
    </div>
  )
}

function DocFrenteDorsoCard({ docId, label, icon, slots, setSlots, errores }: {
  docId: string; label: string; icon: string
  slots: DocSlots; setSlots: (fn: (prev: DocSlots) => DocSlots) => void
  errores: Record<string, string>
}) {
  return (
    <div className="doc-pair">
      <div className="doc-pair-header">
        <span className="doc-pair-icon">{icon}</span>
        <div className="doc-pair-titles">
          <div className="doc-pair-label">{label}</div>
          <div className="doc-pair-hint">Frente y dorso · Obligatorio</div>
        </div>
      </div>
      <div className="doc-pair-body">
        <DocFaceSlot
          slotId={`${docId}_frente`}
          face="Frente"
          slots={slots}
          setSlots={setSlots}
          error={!!errores[`doc_${docId}_frente`]}
        />
        <DocFaceSlot
          slotId={`${docId}_dorso`}
          face="Dorso"
          slots={slots}
          setSlots={setSlots}
          error={!!errores[`doc_${docId}_dorso`]}
        />
      </div>
    </div>
  )
}

function DocFaceSlot({ slotId, face, slots, setSlots, error }: {
  slotId: string; face: string
  slots: DocSlots; setSlots: (fn: (prev: DocSlots) => DocSlots) => void
  error: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)
  const files = slots[slotId] || []

  function handleFiles(newFiles: FileList | null) {
    if (!newFiles) return
    const arr = Array.from(newFiles)
    setSlots(prev => ({ ...prev, [slotId]: [...(prev[slotId] || []), ...arr] }))
  }
  function removeFile(index: number) {
    setSlots(prev => ({ ...prev, [slotId]: (prev[slotId] || []).filter((_, i) => i !== index) }))
  }

  return (
    <div
      className={`doc-face ${files.length > 0 ? 'has-files' : ''} ${dragover ? 'dragover' : ''} ${error && files.length === 0 ? 'required-missing' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={e => { e.preventDefault(); setDragover(false); handleFiles(e.dataTransfer.files) }}
    >
      <div className="doc-face-label">{face}</div>
      <div className="doc-face-state">
        {files.length === 0 ? (
          <>📎 Subir foto</>
        ) : (
          <>✓ {files.length} archivo(s)</>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
      {files.length > 0 && (
        <div className="file-list" onClick={e => e.stopPropagation()}>
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <span className="file-item-name">{f.name}</span>
              <span className="file-item-size">{formatFileSize(f.size)}</span>
              <button className="file-item-remove" onClick={() => removeFile(i)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DocSimpleCard({ slotId, label, icon, required, slots, setSlots, error, hint }: {
  slotId: string; label: string; icon: string; required: boolean
  slots: DocSlots; setSlots: (fn: (prev: DocSlots) => DocSlots) => void
  error: boolean
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)
  const files = slots[slotId] || []

  function handleFiles(newFiles: FileList | null) {
    if (!newFiles) return
    const arr = Array.from(newFiles)
    setSlots(prev => ({ ...prev, [slotId]: [...(prev[slotId] || []), ...arr] }))
  }
  function removeFile(index: number) {
    setSlots(prev => ({ ...prev, [slotId]: (prev[slotId] || []).filter((_, i) => i !== index) }))
  }

  return (
    <div
      className={`doc-card ${files.length > 0 ? 'has-files' : ''} ${dragover ? 'dragover' : ''} ${error && files.length === 0 ? 'required-missing' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={e => { e.preventDefault(); setDragover(false); handleFiles(e.dataTransfer.files) }}
    >
      {required && files.length === 0 && <span className="doc-card-badge">Obligatorio</span>}
      {files.length > 0 && <span className="doc-card-badge ok">{files.length} archivo(s)</span>}
      <div className="doc-card-icon">{icon}</div>
      <div className="doc-card-title">{label}</div>
      <div className="doc-card-hint">{hint || 'Arrastrá o hacé click para subir'}</div>
      <input ref={inputRef} type="file" multiple
        accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      {files.length > 0 && (
        <div className="file-list" onClick={e => e.stopPropagation()}>
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <span className="file-item-name">{f.name}</span>
              <span className="file-item-size">{formatFileSize(f.size)}</span>
              <button className="file-item-remove" onClick={() => removeFile(i)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GeneralUpload({ files, onFilesChange }: {
  files: File[]
  onFilesChange: (fn: (prev: File[]) => File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)

  function handleFiles(newFiles: FileList | null) {
    if (!newFiles) return
    const arr = Array.from(newFiles)
    onFilesChange(prev => [...prev, ...arr])
  }
  function removeFile(index: number) {
    onFilesChange(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <>
      <div className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragover(true) }}
        onDragLeave={() => setDragover(false)}
        onDrop={e => { e.preventDefault(); setDragover(false); handleFiles(e.dataTransfer.files) }}
      >
        <div className="upload-zone-icon">📁</div>
        <div className="upload-zone-text">Arrastrá archivos o hacé click para subir</div>
        <div className="upload-zone-hint">JPG, PNG, PDF, DOC — Máx 10MB por archivo</div>
        <input ref={inputRef} type="file" multiple
          accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <div className="file-list" style={{ marginTop: 12 }}>
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <span className="file-item-name">{f.name}</span>
              <span className="file-item-size">{formatFileSize(f.size)}</span>
              <button className="file-item-remove" onClick={() => removeFile(i)}>×</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
