'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Edit, Loader2, AlertCircle, Send, Trash2, X,
  Check, Download, RefreshCw, User, FileText, MessageCircle,
  Car, Home, Heart, Package, Phone, Mail, ExternalLink
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, formatMoneda, hoyLocal } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, puedeEliminar } from '@/lib/cartera-filter'
import { generarPDFCotizacion, generarPDFCotizacionBlob } from '@/lib/pdf-cotizacion'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { tipoRenderForm, obtenerTipoRiesgo } from '@/lib/tipos-riesgo'

// ── Tipos locales ────────────────────────────────────────────
interface CotizacionDetalle {
  id: string
  numero_cotizacion: string
  persona_id: string | null
  lead_id: string | null
  oportunidad_id: string | null
  ramo_id: string | null
  datos_riesgo: Record<string, any>
  estado: string
  motivo_perdida: string | null
  compania_ganadora_id: string | null
  fecha_envio: string | null
  fecha_cierre: string | null
  fecha_vencimiento: string | null
  notas: string | null
  created_at: string
  updated_at: string
  persona: { id: string; apellido: string; nombre: string | null; dni_cuil: string; telefono: string | null; whatsapp: string | null; email: string | null } | null
  lead: { id: string; apellido: string; nombre: string; dni: string | null; telefono: string | null; email: string | null } | null
  ramo: { id: string; nombre: string; metadata: Record<string, any> | null } | null
  compania_ganadora: { id: string; nombre: string } | null
  oportunidad: { id: string } | null
}

interface CompaniaOpcion {
  id: string
  compania_id: string
  cobertura_id: string | null
  precio: number
  detalle: string | null
  seleccionada: boolean
  compania: { id: string; nombre: string } | null
  cobertura: { id: string; nombre: string; metadata: Record<string, any> | null } | null
}

// ── Constantes ───────────────────────────────────────────────
const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  BORRADOR:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  ENVIADA:    { label: 'Enviada',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  GANADA:     { label: 'Ganada',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:    { label: 'Perdida',    color: 'bg-red-50 text-red-700 border-red-200' },
}

const MOTIVOS_PERDIDA = [
  'Precio alto',
  'Eligió otra compañía',
  'No le interesa',
  'No responde',
  'Otro',
]

const TRANSICIONES: Record<string, string[]> = {
  // Desde BORRADOR el flujo natural es "Marcar como enviada", pero también
  // permitimos cerrar como PERDIDA directamente (caso: el cliente nunca
  // avanzó y se quiere archivar sin enviar).
  BORRADOR:   ['PERDIDA'],
  // ENVIADA → BORRADOR es un rollback (el PAS marcó por error). El resto
  // son las transiciones normales.
  ENVIADA:    ['BORRADOR', 'EN_PROCESO', 'GANADA', 'PERDIDA'],
  EN_PROCESO: ['GANADA', 'PERDIDA'],
}

// Estados terminales: una vez ahí no se vuelve atrás (salvo eliminar).
const ESTADOS_TERMINALES = new Set(['GANADA', 'PERDIDA'])

// ── Helpers ──────────────────────────────────────────────────
function iconoRamo(tipo: string) {
  if (tipo === 'automotor') return <Car className="h-4 w-4 text-blue-500" />
  if (tipo === 'hogar')     return <Home className="h-4 w-4 text-amber-500" />
  if (tipo === 'vida')      return <Heart className="h-4 w-4 text-rose-500" />
  return <Package className="h-4 w-4 text-slate-400" />
}

function renderDatosRiesgo(datos: Record<string, any>, tipoRiesgo: string) {
  const campos: { label: string; valor: string }[] = []
  // Mapeo: los tipos nuevos del catálogo (integrales, personas, etc.) caen
  // en el layout viejo correspondiente.
  const tipoRender = tipoRenderForm(tipoRiesgo)

  if (tipoRender === 'automotor') {
    if (datos.marca)   campos.push({ label: 'Marca',   valor: datos.marca })
    if (datos.modelo)  campos.push({ label: 'Modelo',  valor: datos.modelo })
    if (datos.anio)    campos.push({ label: 'Anio',     valor: datos.anio })
    if (datos.patente) campos.push({ label: 'Patente', valor: datos.patente })
    if (datos.color)   campos.push({ label: 'Color',   valor: datos.color })
    if (datos.uso)     campos.push({ label: 'Uso',     valor: datos.uso })
  } else if (tipoRender === 'hogar') {
    const dir = [datos.calle, datos.numero].filter(Boolean).join(' ')
    if (dir)                    campos.push({ label: 'Direccion',    valor: dir })
    if (datos.localidad)        campos.push({ label: 'Localidad',    valor: datos.localidad })
    if (datos.provincia)        campos.push({ label: 'Provincia',    valor: datos.provincia })
    if (datos.tipo_construccion) campos.push({ label: 'Construccion', valor: datos.tipo_construccion })
    if (datos.superficie)       campos.push({ label: 'Superficie',   valor: `${datos.superficie} m2` })
  } else if (tipoRender === 'vida') {
    if (datos.capital_asegurado) campos.push({ label: 'Capital asegurado', valor: formatMoneda(Number(datos.capital_asegurado)) })
    if (datos.beneficiarios)     campos.push({ label: 'Beneficiarios',     valor: datos.beneficiarios })
  } else if (tipoRender === 'dinamico') {
    // Para los tipos con render dinámico, leemos la definición del tipo de
    // riesgo y mostramos los campos con sus labels reales del catálogo.
    const def = obtenerTipoRiesgo(tipoRiesgo)
    for (const c of def.campos_poliza) {
      const v = datos[c.key]
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        campos.push({ label: c.label, valor: String(v) })
      }
    }
  } else {
    if (datos.descripcion) campos.push({ label: 'Descripcion', valor: datos.descripcion })
  }

  if (campos.length === 0) return <p className="text-xs text-slate-500">Sin datos de riesgo</p>

  return (
    <div className="space-y-1.5">
      {campos.map((c, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span className="text-xs text-slate-500">{c.label}</span>
          <span className="text-xs text-slate-700 font-medium text-right">{c.valor}</span>
        </div>
      ))}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────
export default function FichaCotizacionPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [cotizacion, setCotizacion] = useState<CotizacionDetalle | null>(null)
  const [opciones,   setOpciones]   = useState<CompaniaOpcion[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState('')

  // Modal Enviar
  const [mostrarModalEnviar,  setMostrarModalEnviar]  = useState(false)
  const [enviarFecha,         setEnviarFecha]         = useState(hoyLocal())
  const [guardandoEnviar,     setGuardandoEnviar]     = useState(false)

  // Email
  const [enviandoEmail, setEnviandoEmail] = useState(false)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)

  // Modal Cambiar estado
  const [mostrarModalEstado,   setMostrarModalEstado]   = useState(false)
  const [nuevoEstado,          setNuevoEstado]          = useState('')
  const [estadoFecha,          setEstadoFecha]          = useState(hoyLocal())
  const [estadoMotivo,         setEstadoMotivo]         = useState('')
  const [estadoCompaniaId,     setEstadoCompaniaId]     = useState('')
  const [guardandoEstado,      setGuardandoEstado]      = useState(false)

  // ── Carga de datos ──
  const cargar = useCallback(async () => {
    setCargando(true)
    const [{ data: cot }, { data: opts }] = await Promise.all([
      supabase.from('cotizaciones').select(`
        id, numero_cotizacion, persona_id, lead_id, oportunidad_id, ramo_id,
        datos_riesgo, estado, motivo_perdida, compania_ganadora_id,
        fecha_envio, fecha_cierre, fecha_vencimiento, notas, created_at, updated_at, usuario_id,
        persona:personas!persona_id (id, apellido, nombre, dni_cuil, telefono, whatsapp, email),
        lead:leads!lead_id (id, apellido, nombre, dni, telefono, email),
        ramo:catalogos!ramo_id (id, nombre, metadata),
        compania_ganadora:catalogos!compania_ganadora_id (id, nombre),
        poliza_generada:polizas!poliza_generada_id (id, numero_poliza)
      `).eq('id', id).single(),
      supabase.from('cotizacion_companias').select(`
        id, compania_id, cobertura_id, precio, detalle, seleccionada,
        compania:catalogos!compania_id (id, nombre),
        cobertura:catalogos!cobertura_id (id, nombre, metadata)
      `).eq('cotizacion_id', id).order('precio', { ascending: true }),
    ])

    if (cot) {
      setCotizacion(cot as unknown as CotizacionDetalle)
    }
    setOpciones((opts ?? []) as unknown as CompaniaOpcion[])
    setCargando(false)
  }, [supabase, id])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(!!r.data.activo) })
  }, [])

  // Access check
  useEffect(() => {
    if (!cotizacion || !usuario) return
    if (!tieneAccesoTotal(usuario) && (cotizacion as any).usuario_id !== null && (cotizacion as any).usuario_id !== usuario.id) {
      router.push('/crm/comercial/cotizaciones')
    }
  }, [cotizacion, usuario, router])

  // ── Acciones ──

  const marcarEnviada = async () => {
    setGuardandoEnviar(true); setError('')
    const { error: e } = await supabase.from('cotizaciones').update({
      estado: 'ENVIADA',
      fecha_envio: enviarFecha,
    }).eq('id', id)
    if (e) { setError(e.message) }
    else {
      setMostrarModalEnviar(false)
      cargar()
    }
    setGuardandoEnviar(false)
  }

  const cambiarEstado = async () => {
    if (!nuevoEstado) { setError('Selecciona un estado'); return }
    if (nuevoEstado === 'GANADA' && !estadoCompaniaId) { setError('Selecciona la compania ganadora'); return }
    if (nuevoEstado === 'PERDIDA' && !estadoMotivo) { setError('Selecciona un motivo'); return }

    setGuardandoEstado(true); setError('')

    const updateData: Record<string, any> = { estado: nuevoEstado }
    // fecha_cierre solo en estados terminales. Para EN_PROCESO/BORRADOR/ENVIADA
    // se limpia (caso rollback ENVIADA→BORRADOR de una cotización antes cerrada).
    if (ESTADOS_TERMINALES.has(nuevoEstado)) {
      updateData.fecha_cierre = estadoFecha
    } else {
      updateData.fecha_cierre = null
    }
    if (nuevoEstado === 'GANADA') {
      updateData.compania_ganadora_id = estadoCompaniaId
    }
    if (nuevoEstado === 'PERDIDA') {
      updateData.motivo_perdida = estadoMotivo
    }
    // Si la cotización vuelve a un estado abierto desde un terminal,
    // limpiar el residuo del estado anterior.
    if (!ESTADOS_TERMINALES.has(nuevoEstado)) {
      updateData.compania_ganadora_id = null
      updateData.motivo_perdida = null
    }
    // Rollback ENVIADA→BORRADOR limpia también fecha_envio.
    if (nuevoEstado === 'BORRADOR') {
      updateData.fecha_envio = null
    }

    const { error: e } = await supabase.from('cotizaciones').update(updateData).eq('id', id)
    if (e) { setError(e.message); setGuardandoEstado(false); return }

    // Si GANADA, marcar compania como seleccionada. Si NO es GANADA
    // (incluye rollback desde GANADA, improbable porque es terminal,
    // pero defensivo), limpiar selección.
    if (nuevoEstado === 'GANADA') {
      await supabase.from('cotizacion_companias').update({ seleccionada: false }).eq('cotizacion_id', id)
      await supabase.from('cotizacion_companias').update({ seleccionada: true }).eq('cotizacion_id', id).eq('compania_id', estadoCompaniaId)
    }

    // Actualizar oportunidad vinculada si existe.
    // Solo movemos la oportunidad cuando hay coherencia: si la oportunidad
    // ya está cerrada en un estado distinto al que vamos a aplicar, no la
    // pisamos (el PAS pudo haberla cerrado por separado por otro motivo).
    if (cotizacion?.oportunidad_id) {
      const { data: opActual } = await supabase
        .from('oportunidades')
        .select('estado')
        .eq('id', cotizacion.oportunidad_id)
        .maybeSingle()
      const estadoOp = (opActual as any)?.estado as string | undefined

      if (nuevoEstado === 'GANADA' && estadoOp && !['GANADA', 'PERDIDA'].includes(estadoOp)) {
        await supabase.from('oportunidades').update({ estado: 'GANADA' }).eq('id', cotizacion.oportunidad_id)
      } else if (nuevoEstado === 'PERDIDA' && estadoOp && !['GANADA', 'PERDIDA'].includes(estadoOp)) {
        await supabase.from('oportunidades').update({ estado: 'PERDIDA', motivo_perdida: estadoMotivo }).eq('id', cotizacion.oportunidad_id)
      }
    }

    setMostrarModalEstado(false)
    setNuevoEstado('')
    setEstadoMotivo('')
    setEstadoCompaniaId('')
    cargar()
    setGuardandoEstado(false)
  }

  // Carga el logo desde storage y lo convierte a data URL para que jsPDF
  // pueda embeberlo en el PDF. Devuelve null si falla (404, error de red,
  // formato no soportado, etc.) — el PDF cae al layout solo-texto.
  const cargarLogoComoDataURL = async (logoPath: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/storage/${logoPath}`)
      if (!res.ok) return null
      const blob = await res.blob()
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  // Helper compartido: arma los datos para los generadores de PDF (save/blob).
  // Evita la duplicación entre exportarPDF() y enviarPorEmail().
  const armarDatosPDF = async () => {
    if (!cotizacion) return null

    const { data: config } = await supabase
      .from('configuracion')
      .select('nombre, razon_social, telefono, email, direccion, matricula_ssn, logo_path, color_marca, usar_logo')
      .limit(1)
      .single()
    const c = (config as any) ?? {}
    // Si hay logo_path Y usar_logo no es false, intentamos cargar el logo como
    // data URL para embeberlo en el PDF. Si falla (404, problema de red, etc.)
    // o si el PAS optó por no usar logo, caemos al layout solo-texto.
    const mostrarLogo = c.usar_logo !== false && !!c.logo_path
    const logoDataUrl = mostrarLogo ? await cargarLogoComoDataURL(c.logo_path) : null
    const organizacion = {
      nombre: c.nombre ?? null,
      razon_social: c.razon_social ?? null,
      telefono: c.telefono ?? null,
      email: c.email ?? null,
      direccion: c.direccion ?? null,
      matricula_ssn: c.matricula_ssn ?? null,
      logo_data_url: logoDataUrl,
      color_marca: c.color_marca ?? null,
    }

    const tipoRiesgo = (cotizacion.ramo?.metadata ?? {}).tipo_riesgo ?? 'generico'

    const datosDestinatario = cotizacion.persona
      ? {
          nombre: cotizacion.persona.nombre ?? '',
          apellido: cotizacion.persona.apellido,
          dni: cotizacion.persona.dni_cuil,
          telefono: cotizacion.persona.telefono,
          email: cotizacion.persona.email,
        }
      : cotizacion.lead
        ? {
            nombre: cotizacion.lead.nombre,
            apellido: cotizacion.lead.apellido,
            dni: cotizacion.lead.dni,
            telefono: cotizacion.lead.telefono,
            email: cotizacion.lead.email,
          }
        : { nombre: '', apellido: 'Sin destinatario', dni: null, telefono: null, email: null }

    const companias = opciones.map(o => {
      const meta = (o.cobertura?.metadata ?? {}) as Record<string, any>
      const cubreRaw = Array.isArray(meta.cubre) ? meta.cubre : null
      return {
        compania_nombre: o.compania?.nombre ?? '—',
        cobertura_id: o.cobertura?.id ?? null,
        cobertura_nombre: o.cobertura?.nombre ?? null,
        cobertura_descripcion: typeof meta.descripcion === 'string' ? meta.descripcion : null,
        cobertura_cubre: cubreRaw ? cubreRaw.map((x: any) => String(x)).filter((x: string) => x.trim()) : null,
        precio: o.precio,
        detalle: o.detalle,
        seleccionada: o.seleccionada,
      }
    })

    const datosCotizacion = {
      numero_cotizacion: cotizacion.numero_cotizacion,
      fecha: cotizacion.fecha_envio ?? cotizacion.created_at,
      ramo: cotizacion.ramo?.nombre ?? '—',
      datos_riesgo: cotizacion.datos_riesgo ?? {},
      tipo_riesgo: tipoRiesgo,
      notas: cotizacion.notas,
      fecha_vencimiento: cotizacion.fecha_vencimiento,
    }

    return { datosCotizacion, datosDestinatario, companias, organizacion }
  }

  const exportarPDF = async () => {
    const datos = await armarDatosPDF()
    if (!datos) return
    generarPDFCotizacion(datos.datosCotizacion, datos.datosDestinatario, datos.companias, datos.organizacion)
  }

  // Aplica un template de mensaje con interpolación de variables.
  // Variables soportadas: {nombre}, {numero}, {ramo}, {opciones}.
  // Si una variable no está en el contexto se reemplaza por string vacío
  // y se hace cleanup de espacios duplicados / "de" colgados.
  const aplicarTemplate = (template: string): string => {
    if (!cotizacion) return template
    const nombrePila = cotizacion.persona?.nombre || cotizacion.persona?.apellido
      || cotizacion.lead?.nombre || cotizacion.lead?.apellido || ''
    const ramo = cotizacion.ramo?.nombre ?? ''
    const cantOpc = opciones.length
    return template
      .replaceAll('{nombre}', nombrePila)
      .replaceAll('{numero}', cotizacion.numero_cotizacion)
      .replaceAll('{ramo}', ramo)
      .replaceAll('{opciones}', String(cantOpc))
      // Cleanup de espacios duplicados que pueden quedar al expandir variables vacías
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  // Enviar por WhatsApp: descarga el PDF y abre wa.me con un mensaje
  // pre-armado en una nueva pestaña. WhatsApp no permite adjuntar
  // archivos vía URL — el cliente debe arrastrar/elegir el PDF descargado
  // manualmente desde el chat. Es lo mejor que se puede hacer sin la
  // WhatsApp Business API.
  const enviarPorWhatsApp = async () => {
    if (!cotizacion) return
    // Tomamos whatsapp dedicado (más confiable) o telefono como fallback,
    // y removemos todo lo que no sea dígito (espacios, guiones, paréntesis,
    // signo +). El número resultante es el que `wa.me` espera (E.164 sin '+').
    const numeroRaw = cotizacion.persona?.whatsapp ?? cotizacion.persona?.telefono ?? cotizacion.lead?.telefono ?? ''
    const numero = numeroRaw.replace(/\D/g, '')
    if (!numero) {
      setError('El destinatario no tiene teléfono ni WhatsApp cargado')
      return
    }

    // Descargamos el PDF para que el PAS pueda adjuntarlo en el chat.
    await exportarPDF()

    // Plantilla editable de WhatsApp desde /crm/configuracion/comunicaciones tab WhatsApp.
    const nombreCliente = cotizacion.persona?.nombre || cotizacion.lead?.nombre || ''
    const url = await construirUrlWhatsapp('envio_cotizacion', numero, {
      nombre: nombreCliente,
      numero_cotizacion: cotizacion.numero_cotizacion ?? '',
      ramo: cotizacion.ramo?.nombre ?? '',
    })
    window.open(url, '_blank')

    // Si está en BORRADOR, ofrecer marcar como ENVIADA (mismo flujo que email).
    if (cotizacion.estado === 'BORRADOR') {
      if (confirm('Se abrió WhatsApp y se descargó el PDF. ¿Marcar la cotización como ENVIADA?')) {
        await supabase.from('cotizaciones').update({ estado: 'ENVIADA', fecha_envio: hoyLocal() }).eq('id', id)
        cargar()
      }
    }
  }

  const enviarPorEmail = async () => {
    if (!cotizacion) return
    const email = cotizacion.persona?.email ?? cotizacion.lead?.email
    if (!email) { setError('El destinatario no tiene email cargado'); return }

    setEnviandoEmail(true); setError('')
    try {
      const datos = await armarDatosPDF()
      if (!datos) return

      const pdfFile = generarPDFCotizacionBlob(
        datos.datosCotizacion,
        datos.datosDestinatario,
        datos.companias,
        datos.organizacion,
      )

      // Cargamos los templates configurados por el PAS. Si no hay (default
      // antiguo o limpiados), usamos los textos default razonables.
      const { data: cfg } = await supabase
        .from('configuracion')
        .select('cotizacion_email_asunto_template, cotizacion_email_cuerpo_template')
        .limit(1)
        .single()
      const asuntoTemplate = (cfg as any)?.cotizacion_email_asunto_template
        || 'Cotización {numero} - {ramo}'
      const cuerpoTemplate = (cfg as any)?.cotizacion_email_cuerpo_template
        || 'Hola {nombre}, adjuntamos la cotización N° {numero} solicitada para su evaluación. Quedamos a disposición para cualquier consulta.'

      const asunto = aplicarTemplate(asuntoTemplate)
      const cuerpoMensaje = aplicarTemplate(cuerpoTemplate)

      const formData = new FormData()
      // Plantilla: usamos `notificacion_general` (única plantilla genérica
      // disponible en DB para envíos manuales con título + cuerpo).
      formData.append('plantilla_codigo', 'notificacion_general')
      if (cotizacion.persona_id) formData.append('persona_id', cotizacion.persona_id)
      formData.append('asunto', asunto)
      formData.append('campos_editables', JSON.stringify({
        titulo: asunto,
        cuerpo_mensaje: cuerpoMensaje,
      }))
      // Para destinatarios sin persona en DB (leads), el endpoint acepta
      // email_directo + nombre_directo.
      if (!cotizacion.persona_id) {
        formData.append('email_directo', email)
        const nombreCompleto = [datos.datosDestinatario.nombre, datos.datosDestinatario.apellido].filter(Boolean).join(' ').trim()
        formData.append('nombre_directo', nombreCompleto || email)
      }
      formData.append('archivos', pdfFile)

      const r = await apiCall('/api/comunicaciones/enviar', { method: 'POST', body: formData }, { mostrar_toast_en_error: false })

      if (r.ok) {
        toast.exito('Email enviado')
        if (cotizacion.estado === 'BORRADOR') {
          if (confirm('Email enviado. ¿Marcar la cotización como ENVIADA?')) {
            await supabase.from('cotizaciones').update({ estado: 'ENVIADA', fecha_envio: hoyLocal() }).eq('id', id)
          }
        }
        cargar()
      } else {
        setError(r.error?.mensaje || 'Error al enviar el email')
      }
    } finally {
      setEnviandoEmail(false)
    }
  }

  const eliminar = async () => {
    if (!cotizacion) return
    // Si la cotización está GANADA y tiene una oportunidad **que está
    // también en GANADA**, asumimos que esta cotización fue lo que cerró
    // la oportunidad y la revertimos a NEGOCIACION para mantener
    // trazabilidad. Si la oportunidad ya está en otro estado (PERDIDA,
    // u otro) no la pisamos — el PAS la pudo haber cerrado por separado.
    let revertirOportunidad = false
    if (cotizacion.estado === 'GANADA' && cotizacion.oportunidad_id) {
      const { data: opActual } = await supabase
        .from('oportunidades')
        .select('estado')
        .eq('id', cotizacion.oportunidad_id)
        .maybeSingle()
      revertirOportunidad = (opActual as any)?.estado === 'GANADA'
    }
    const mensaje = revertirOportunidad
      ? 'Esta cotización está marcada como GANADA. Eliminarla revertirá la oportunidad asociada al estado NEGOCIACION para mantener trazabilidad. ¿Continuar?'
      : '¿Eliminar esta cotizacion? Se eliminaran todas las opciones de companias.'
    if (!confirm(mensaje)) return

    if (revertirOportunidad && cotizacion.oportunidad_id) {
      const { error: errOp } = await supabase
        .from('oportunidades')
        .update({
          estado: 'NEGOCIACION',
          motivo_perdida: null,
        })
        .eq('id', cotizacion.oportunidad_id)
      if (errOp) {
        toast.error(`No se pudo revertir la oportunidad: ${errOp.message}`)
        return
      }
    }

    // FK cotizacion_companias.cotizacion_id tiene ON DELETE CASCADE.
    const { error: errDel } = await supabase.from('cotizaciones').delete().eq('id', id)
    if (errDel) {
      toast.error(`No se pudo eliminar la cotización: ${errDel.message}`)
      return
    }
    router.push('/crm/comercial/cotizaciones')
  }

  const renovarCotizacion = async () => {
    if (!cotizacion) return
    // Defensa en profundidad: solo se renueva desde estados activos
    // (la UI ya lo limita al banner de "vencida", pero la función
    // pública debe validarlo por si se llama programáticamente).
    if (!['ENVIADA', 'EN_PROCESO'].includes(cotizacion.estado)) {
      setError('Solo se pueden renovar cotizaciones en estado Enviada o En proceso')
      return
    }
    setError('')
    try {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      const nuevaVenc = d.toISOString().split('T')[0]

      const payload: Record<string, any> = {
        numero_cotizacion: '',
        persona_id: cotizacion.persona_id || null,
        lead_id: cotizacion.lead_id || null,
        oportunidad_id: cotizacion.oportunidad_id || null,
        ramo_id: cotizacion.ramo_id || null,
        datos_riesgo: cotizacion.datos_riesgo ?? {},
        notas: cotizacion.notas || null,
        estado: 'BORRADOR',
        fecha_vencimiento: nuevaVenc,
        usuario_id: (cotizacion as any).usuario_id ?? usuario?.id ?? null,
      }

      const { data: nueva, error: insErr } = await supabase
        .from('cotizaciones')
        .insert(payload)
        .select('id')
        .single()

      if (insErr || !nueva) { setError(insErr?.message ?? 'Error al renovar'); return }
      const nuevaId = (nueva as unknown as { id: string }).id

      // Copiar cotizacion_companias
      if (opciones.length > 0) {
        const companiaRows = opciones.map(o => ({
          cotizacion_id: nuevaId,
          compania_id: o.compania_id,
          cobertura_id: o.cobertura_id,
          precio: o.precio,
          detalle: o.detalle,
        }))
        await supabase.from('cotizacion_companias').insert(companiaRows)
      }

      router.push(`/crm/comercial/cotizaciones/${nuevaId}/editar`)
    } catch (e: any) {
      setError(e.message ?? 'Error al renovar')
    }
  }

  // ── Render ──

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400 text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Cargando cotizacion...
      </div>
    )
  }

  if (!cotizacion) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <AlertCircle className="h-10 w-10 text-slate-300" />
        <p className="text-sm text-slate-500">Cotizacion no encontrada</p>
        <button onClick={() => router.push('/crm/comercial/cotizaciones')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Volver a cotizaciones
        </button>
      </div>
    )
  }

  const eb = ESTADO_BADGE[cotizacion.estado] ?? ESTADO_BADGE.BORRADOR
  const tipoRiesgo = (cotizacion.ramo?.metadata ?? {}).tipo_riesgo ?? 'generico'
  const transicionesDisponibles = TRANSICIONES[cotizacion.estado] ?? []
  const precioMinimo = opciones.length > 0 ? Math.min(...opciones.map(o => o.precio)) : null

  // Calculo de vencimiento
  const hoyStr = hoyLocal()
  const estadoEnCurso = cotizacion.estado === 'ENVIADA' || cotizacion.estado === 'EN_PROCESO'
  const vencida = !!cotizacion.fecha_vencimiento && cotizacion.fecha_vencimiento < hoyStr && estadoEnCurso
  let diasVencimientoLabel = ''
  if (cotizacion.fecha_vencimiento) {
    const fv = new Date(cotizacion.fecha_vencimiento + 'T00:00:00')
    const hh = new Date(hoyStr + 'T00:00:00')
    const diff = Math.round((fv.getTime() - hh.getTime()) / (1000 * 60 * 60 * 24))
    if (diff < 0) diasVencimientoLabel = `(vencida hace ${Math.abs(diff)} día${Math.abs(diff) === 1 ? '' : 's'})`
    else if (diff === 0) diasVencimientoLabel = '(vence hoy)'
    else diasVencimientoLabel = `(en ${diff} día${diff === 1 ? '' : 's'})`
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/crm/comercial/cotizaciones')} className="btn-secondary p-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">
                Cotizacion <span className="font-mono">{cotizacion.numero_cotizacion}</span>
              </h1>
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>
                {eb.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Creada el {formatFechaLocalLarga(cotizacion.created_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {cotizacion.estado === 'BORRADOR' && (
            <button onClick={() => router.push(`/crm/comercial/cotizaciones/${id}/editar`)} className="btn-secondary">
              <Edit className="h-3 w-3" /> Editar
            </button>
          )}
          {cotizacion.estado === 'BORRADOR' && (
            <button
              onClick={() => { setEnviarFecha(hoyLocal()); setMostrarModalEnviar(true) }}
              className="btn-secondary"
              title="Cambia el estado a ENVIADA. NO manda email — usalo si ya se la pasaste al cliente por WhatsApp/teléfono/etc."
            >
              <Send className="h-3 w-3" /> Marcar como enviada
            </button>
          )}
          {transicionesDisponibles.length > 0 && (
            <button onClick={() => { setNuevoEstado(''); setEstadoFecha(hoyLocal()); setEstadoMotivo(''); setEstadoCompaniaId(''); setMostrarModalEstado(true) }} className="btn-secondary">
              <RefreshCw className="h-3 w-3" /> Cambiar estado
            </button>
          )}
          <button onClick={exportarPDF} className="btn-secondary" title="Descarga el PDF de la cotización">
            <Download className="h-3 w-3" /> Exportar PDF
          </button>

          {/* Botones de envío: solo en estados activos. Siempre se muestran,
              y se deshabilitan con tooltip si falta config (SMTP, teléfono, etc.) —
              así el PAS sabe que la opción existe y qué le falta para usarla. */}
          {['BORRADOR', 'ENVIADA', 'EN_PROCESO'].includes(cotizacion.estado) && (() => {
            const emailDest = cotizacion.persona?.email ?? cotizacion.lead?.email
            const telDest = cotizacion.persona?.whatsapp ?? cotizacion.persona?.telefono ?? cotizacion.lead?.telefono
            const sinEmail = !emailDest
            const sinTel = !telDest

            // Razones por las que cada botón no se puede usar.
            // El email tiene 2 prerrequisitos: que exista email y que el sistema
            // de comunicaciones esté activo (SMTP configurado).
            let motivoEmailDeshab = ''
            if (!comunicacionesActivo) motivoEmailDeshab = 'Configurá SMTP en Configuración → Correos para habilitar el envío por email'
            else if (sinEmail) motivoEmailDeshab = 'El destinatario no tiene email cargado'

            // Para WhatsApp solo necesitamos un número.
            const motivoWhatsappDeshab = sinTel ? 'El destinatario no tiene teléfono ni WhatsApp cargado' : ''

            return (
              <>
                <button
                  onClick={enviarPorWhatsApp}
                  disabled={!!motivoWhatsappDeshab}
                  title={motivoWhatsappDeshab || 'Descarga el PDF y abre WhatsApp con un mensaje pre-armado para que lo adjuntes'}
                  className={`btn-primary border-emerald-600 ${
                    motivoWhatsappDeshab
                      ? 'bg-emerald-300 hover:bg-emerald-300 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <MessageCircle className="h-3 w-3" /> Enviar por WhatsApp
                </button>

                <button
                  onClick={enviarPorEmail}
                  disabled={enviandoEmail || !!motivoEmailDeshab}
                  title={motivoEmailDeshab || 'Manda el PDF por email al destinatario'}
                  className={`btn-primary border-violet-600 ${
                    motivoEmailDeshab
                      ? 'bg-violet-300 hover:bg-violet-300 cursor-not-allowed'
                      : 'bg-violet-600 hover:bg-violet-700'
                  }`}
                >
                  {enviandoEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                  {enviandoEmail ? 'Enviando...' : 'Enviar por email'}
                </button>
              </>
            )
          })()}
          {cotizacion.estado === 'GANADA' && !(cotizacion as any).poliza_generada_id && (
            <button onClick={() => router.push(`/crm/polizas/nueva?from_cotizacion=${id}`)}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
              <FileText className="h-3 w-3" /> Crear póliza
            </button>
          )}
          {cotizacion.estado === 'BORRADOR' && puedeEliminar(usuario) && (
            <button
              onClick={eliminar}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
              title="Eliminar esta cotización"
            >
              <Trash2 className="h-3 w-3" /> Eliminar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-600 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {vencida && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-xs text-amber-800">
            <span className="font-semibold">⚠️ Esta cotización venció el {formatFechaLocalLarga(cotizacion.fecha_vencimiento!)}.</span>
            {' '}Considerá renovarla o ajustar precios.
          </div>
          <button onClick={renovarCotizacion} className="btn-primary text-xs flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Renovar cotización
          </button>
        </div>
      )}

      {/* ── Layout 2 columnas ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* ── SIDEBAR ── */}
        <div className="col-span-1 flex flex-col gap-3">

          {/* Card: Destinatario */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Destinatario
            </h3>
            {cotizacion.persona ? (
              <div className="space-y-1.5">
                <button
                  onClick={() => router.push(`/crm/personas/${cotizacion.persona!.id}`)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left"
                >
                  {cotizacion.persona.apellido}{cotizacion.persona.nombre ? `, ${cotizacion.persona.nombre}` : ''}
                </button>
                <div className="text-xs text-slate-500 font-mono">{cotizacion.persona.dni_cuil}</div>
                {cotizacion.persona.telefono && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Phone className="h-3 w-3 text-slate-400" /> {cotizacion.persona.telefono}
                  </div>
                )}
                {cotizacion.persona.email && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Mail className="h-3 w-3 text-slate-400" /> {cotizacion.persona.email}
                  </div>
                )}
              </div>
            ) : cotizacion.lead ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => router.push(`/crm/comercial/leads/${cotizacion.lead!.id}`)}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left"
                  >
                    {cotizacion.lead.apellido}, {cotizacion.lead.nombre}
                  </button>
                  <span className="text-2xs bg-cyan-50 text-cyan-700 border border-cyan-200 px-1 rounded font-semibold">Lead</span>
                </div>
                {cotizacion.lead.telefono && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Phone className="h-3 w-3 text-slate-400" /> {cotizacion.lead.telefono}
                  </div>
                )}
                {cotizacion.lead.email && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Mail className="h-3 w-3 text-slate-400" /> {cotizacion.lead.email}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Sin destinatario asignado</p>
            )}
          </div>

          {/* Card: Datos del riesgo */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              {iconoRamo(tipoRiesgo)} Datos del riesgo
            </h3>
            {cotizacion.ramo && (
              <div className="text-xs text-slate-600 mb-2 font-medium">{cotizacion.ramo.nombre}</div>
            )}
            {renderDatosRiesgo(cotizacion.datos_riesgo ?? {}, tipoRiesgo)}
          </div>

          {/* Card: Informacion */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Informacion
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Estado</span>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>{eb.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">Creada</span>
                <span className="text-xs text-slate-700">{formatFechaLocalLarga(cotizacion.created_at)}</span>
              </div>
              {cotizacion.fecha_envio && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">Enviada</span>
                  <span className="text-xs text-slate-700">{formatFechaLocalLarga(cotizacion.fecha_envio)}</span>
                </div>
              )}
              {cotizacion.fecha_cierre && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">Cierre</span>
                  <span className="text-xs text-slate-700">{formatFechaLocalLarga(cotizacion.fecha_cierre)}</span>
                </div>
              )}
              {cotizacion.fecha_vencimiento && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">Vence</span>
                  <span className={`text-xs ${vencida ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                    {formatFechaLocalLarga(cotizacion.fecha_vencimiento)} <span className="text-2xs text-slate-500">{diasVencimientoLabel}</span>
                  </span>
                </div>
              )}
              {cotizacion.estado === 'GANADA' && cotizacion.compania_ganadora && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">Ganadora</span>
                  <span className="text-xs text-emerald-700 font-semibold">{cotizacion.compania_ganadora.nombre}</span>
                </div>
              )}
              {cotizacion.estado === 'PERDIDA' && cotizacion.motivo_perdida && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">Motivo</span>
                  <span className="text-xs text-red-600">{cotizacion.motivo_perdida}</span>
                </div>
              )}
              {cotizacion.oportunidad_id && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Oportunidad</span>
                  <button
                    onClick={() => router.push(`/crm/comercial/oportunidades/${cotizacion.oportunidad_id}`)}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Ver oportunidad
                  </button>
                </div>
              )}
              {(cotizacion as any).poliza_generada_id && (cotizacion as any).poliza_generada && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Póliza generada</span>
                  <button
                    onClick={() => router.push(`/crm/polizas/${(cotizacion as any).poliza_generada_id}`)}
                    className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Check className="h-3 w-3" /> {(cotizacion as any).poliza_generada.numero_poliza}
                  </button>
                </div>
              )}
              {cotizacion.notas && (
                <div className="pt-1.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 block mb-1">Notas</span>
                  <p className="text-xs text-slate-700 whitespace-pre-line">{cotizacion.notas}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="col-span-2 flex flex-col gap-3">

          {/* Comparativa de opciones */}
          <div className="bg-white border border-slate-200 rounded">
            <div className="px-3 py-2.5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-slate-400" /> Comparativa de opciones
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{opciones.length} {opciones.length === 1 ? 'opcion comparada' : 'opciones comparadas'}</p>
            </div>

            {opciones.length === 0 ? (
              <div className="flex flex-col items-center py-10 gap-2">
                <FileText className="h-8 w-8 text-slate-300" />
                <p className="text-xs text-slate-500">No hay opciones de companias cargadas</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-2xs font-semibold text-slate-500 uppercase tracking-wide">Compania</th>
                      <th className="text-left px-3 py-2 text-2xs font-semibold text-slate-500 uppercase tracking-wide">Cobertura</th>
                      <th className="text-right px-3 py-2 text-2xs font-semibold text-slate-500 uppercase tracking-wide">Precio</th>
                      <th className="text-left px-3 py-2 text-2xs font-semibold text-slate-500 uppercase tracking-wide">Detalle</th>
                      {cotizacion.estado === 'GANADA' && (
                        <th className="text-center px-3 py-2 text-2xs font-semibold text-slate-500 uppercase tracking-wide" style={{ width: 80 }}>Seleccionada</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {opciones.map((o) => {
                      const esGanadora = cotizacion.estado === 'GANADA' && o.seleccionada
                      const esMejorPrecio = o.precio === precioMinimo
                      return (
                        <tr key={o.id} className={`border-b border-slate-100 last:border-b-0 ${esGanadora ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-semibold ${esGanadora ? 'text-emerald-800' : 'text-slate-700'}`}>
                              {o.compania?.nombre ?? '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-slate-600">{o.cobertura?.nombre ?? '—'}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`text-xs font-mono font-semibold ${esGanadora ? 'text-emerald-800' : 'text-slate-700'}`}>
                                {formatMoneda(o.precio)}
                              </span>
                              {esMejorPrecio && opciones.length > 1 && (
                                <span className="text-2xs font-semibold px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                                  Mejor precio
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-slate-600">{o.detalle ?? '—'}</span>
                          </td>
                          {cotizacion.estado === 'GANADA' && (
                            <td className="px-3 py-2.5 text-center">
                              {o.seleccionada && <Check className="h-4 w-4 text-emerald-600 mx-auto" />}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal: Marcar como enviada ── */}
      {mostrarModalEnviar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setMostrarModalEnviar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Marcar como enviada</h3>
              <button onClick={() => setMostrarModalEnviar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-2xs text-amber-800">
              <strong>Esto solo cambia el estado a ENVIADA.</strong> No manda ningún email.
              Usalo si ya se la pasaste al cliente por WhatsApp, teléfono o personalmente.
              Si querés mandarla por email desde el CRM, necesitás configurar SMTP en Configuración → Correos.
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">Fecha en que la enviaste</label>
              <input type="date" className="form-input w-full" value={enviarFecha} onChange={e => setEnviarFecha(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMostrarModalEnviar(false)} className="btn-secondary">Cancelar</button>
              <button onClick={marcarEnviada} disabled={guardandoEnviar} className="btn-primary">
                {guardandoEnviar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Cambiar estado ── */}
      {mostrarModalEstado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setMostrarModalEstado(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Cambiar estado</h3>
              <button onClick={() => setMostrarModalEstado(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nuevo estado</label>
                <select className="form-input w-full" value={nuevoEstado} onChange={e => { setNuevoEstado(e.target.value); setEstadoMotivo(''); setEstadoCompaniaId('') }}>
                  <option value="">Seleccionar...</option>
                  {transicionesDisponibles.map(e => {
                    const badge = ESTADO_BADGE[e] ?? ESTADO_BADGE.BORRADOR
                    return <option key={e} value={e}>{badge.label}</option>
                  })}
                </select>
              </div>

              {nuevoEstado === 'GANADA' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Compania ganadora <span className="text-red-500">*</span></label>
                  <select className="form-input w-full" value={estadoCompaniaId} onChange={e => setEstadoCompaniaId(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {opciones.map(o => (
                      <option key={o.id} value={o.compania_id}>{o.compania?.nombre ?? '—'} - {formatMoneda(o.precio)}</option>
                    ))}
                  </select>
                </div>
              )}

              {nuevoEstado === 'PERDIDA' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Motivo <span className="text-red-500">*</span></label>
                  <select className="form-input w-full" value={estadoMotivo} onChange={e => setEstadoMotivo(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {MOTIVOS_PERDIDA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              {nuevoEstado === 'BORRADOR' && cotizacion.estado === 'ENVIADA' && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                  Volvés la cotización a borrador. Se va a limpiar la fecha de envío para mantener consistencia.
                </div>
              )}

              {ESTADOS_TERMINALES.has(nuevoEstado) && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de cierre</label>
                  <input type="date" className="form-input w-full" value={estadoFecha} onChange={e => setEstadoFecha(e.target.value)} />
                </div>
              )}
            </div>

            {error && (
              <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {error}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setMostrarModalEstado(false)} className="btn-secondary">Cancelar</button>
              <button onClick={cambiarEstado} disabled={guardandoEstado || !nuevoEstado} className="btn-primary">
                {guardandoEstado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
