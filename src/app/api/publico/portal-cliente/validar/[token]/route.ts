import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

async function listarDocumentacionPoliza(numero_poliza: string): Promise<Array<{ nombre: string; ruta: string; tamano: number }>> {
  const dir = path.join(STORAGE_ROOT, 'polizas', numero_poliza, 'documentacion')
  if (!dir.startsWith(STORAGE_ROOT)) return []
  if (!existsSync(dir)) return []
  try {
    const files = await readdir(dir)
    const out: Array<{ nombre: string; ruta: string; tamano: number }> = []
    for (const f of files) {
      const full = path.join(dir, f)
      try {
        const s = await stat(full)
        if (s.isFile()) {
          out.push({
            nombre: f,
            ruta: `polizas/${numero_poliza}/documentacion/${f}`,
            tamano: s.size,
          })
        }
      } catch { /* skip */ }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Lista archivos que el PAS carga en la ficha del siniestro para que el
 * asegurado los descargue (denuncia administrativa presentada a la compañía,
 * certificado de cobertura, carta de franquicia, etc.).
 *
 * NO se muestra la categoría 'documentacion' — esa es la que sube el asegurado
 * al denunciar (el asegurado ya la tiene, sería redundante).
 */
async function listarDocumentacionSiniestro(numero_caso: string): Promise<Array<{ nombre: string; ruta: string; tamano: number }>> {
  const dir = path.join(STORAGE_ROOT, 'siniestros', numero_caso, 'documentacion_denuncia')
  if (!dir.startsWith(STORAGE_ROOT)) return []
  if (!existsSync(dir)) return []
  try {
    const files = await readdir(dir)
    const out: Array<{ nombre: string; ruta: string; tamano: number }> = []
    for (const f of files) {
      const full = path.join(dir, f)
      try {
        const s = await stat(full)
        if (s.isFile()) {
          out.push({
            nombre: f,
            ruta: `siniestros/${numero_caso}/documentacion_denuncia/${f}`,
            tamano: s.size,
          })
        }
      } catch { /* skip */ }
    }
    return out
  } catch {
    return []
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    // 1. Rate limit por IP
    const ip = getClientIp(request)
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'publico-portal-cliente',
      maxRequests: 100,
      windowSeconds: 60,
      failMode: 'closed',
    })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiadas solicitudes' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const { token } = await params
    const supabase = getSupabaseAdmin()

    // 2. Verificar sistema activo
    const { data: config } = await supabase
      .from('configuracion_portal_cliente')
      .select('*')
      .limit(1)
      .maybeSingle()

    const configuracion = config as any
    if (!configuracion?.activo) {
      return NextResponse.json(
        { ok: false, error: 'El portal del cliente no está disponible.' },
        { status: 503 }
      )
    }

    // 3. Validar token
    const validacion = await validarTokenAcceso(token, ip)
    if (!validacion.valido || !validacion.persona_id) {
      return NextResponse.json(
        {
          ok: false,
          error: configuracion.mensaje_acceso_revocado || 'Acceso no disponible',
        },
        { status: 403 }
      )
    }

    const personaId = validacion.persona_id

    // 4. Datos del cliente (incluye contacto + dirección para sección "Mis datos")
    const { data: persona } = await supabase
      .from('personas')
      .select(
        'id, nombre, apellido, razon_social, tipo_persona, email, email_secundario, telefono, telefono_secundario, whatsapp, calle, numero, piso_depto, barrio, localidad, provincia, codigo_postal'
      )
      .eq('id', personaId)
      .maybeSingle()

    if (!persona) {
      return NextResponse.json({ ok: false, error: 'Cliente no encontrado' }, { status: 404 })
    }

    // 5. Pólizas vigentes con compañía, ramo, cobertura, riesgo
    const { data: polizas } = await supabase
      .from('polizas')
      .select(
        'id, numero_poliza, fecha_inicio, fecha_fin, estado, compania_id, ramo_id, cobertura_id, suma_asegurada, moneda, mostrar_suma_asegurada_portal, observaciones'
      )
      .eq('asegurado_id', personaId)
      .eq('estado', 'VIGENTE')
      .order('fecha_fin', { ascending: true })

    const polizasArr = (polizas ?? []) as any[]

    // Catálogos (compañías, ramos, coberturas) involucrados
    const companiaIds = Array.from(
      new Set(polizasArr.map(p => p.compania_id).filter(Boolean))
    ) as string[]
    const ramoIds = Array.from(
      new Set(polizasArr.map(p => p.ramo_id).filter(Boolean))
    ) as string[]
    const coberturaIds = Array.from(
      new Set(polizasArr.map(p => p.cobertura_id).filter(Boolean))
    ) as string[]

    const [catCompania, catRamo, catCobertura] = await Promise.all([
      companiaIds.length
        ? supabase.from('catalogos').select('id, nombre').in('id', companiaIds)
        : Promise.resolve({ data: [] }),
      ramoIds.length
        ? supabase.from('catalogos').select('id, nombre').in('id', ramoIds)
        : Promise.resolve({ data: [] }),
      coberturaIds.length
        ? supabase.from('catalogos').select('id, nombre').in('id', coberturaIds)
        : Promise.resolve({ data: [] }),
    ])

    const mapCompania = new Map<string, string>()
    for (const c of ((catCompania as any).data ?? []) as any[]) mapCompania.set(c.id, c.nombre)
    const mapRamo = new Map<string, string>()
    for (const r of ((catRamo as any).data ?? []) as any[]) mapRamo.set(r.id, r.nombre)
    const mapCobertura = new Map<string, string>()
    for (const c of ((catCobertura as any).data ?? []) as any[]) mapCobertura.set(c.id, c.nombre)

    // Riesgos de las pólizas (con detalle técnico para mostrar al asegurado:
    // patente/marca/modelo/dirección, etc.)
    const polizaIds = polizasArr.map(p => p.id)
    const { data: riesgosData } = polizaIds.length
      ? await supabase
          .from('riesgos')
          .select('poliza_id, descripcion_corta, tipo_riesgo, detalle_tecnico, suma_asegurada, numero_item')
          .in('poliza_id', polizaIds)
          .eq('activo', true)
          .order('numero_item', { ascending: true })
      : { data: [] as any[] }

    const mapRiesgos = new Map<string, any[]>()
    for (const r of ((riesgosData ?? []) as any[])) {
      if (!mapRiesgos.has(r.poliza_id)) mapRiesgos.set(r.poliza_id, [])
      mapRiesgos.get(r.poliza_id)!.push({
        descripcion: r.descripcion_corta,
        tipo: r.tipo_riesgo,
        detalle: r.detalle_tecnico ?? {},
        suma_asegurada: r.suma_asegurada ?? null,
      })
    }

    // Renovaciones pendientes — pólizas hijas en estado RENOVADA o PROGRAMADA
    // que apuntan como origen a alguna de las vigentes. Se muestran como un
    // badge "Renovación gestionada — Vigente desde DD/MM/YYYY" en la card de
    // la póliza vigente actual (task v1.0.127). Cero cards nuevos en el portal.
    const { data: renovacionesData } = polizaIds.length
      ? await supabase
          .from('polizas')
          .select('id, numero_poliza, fecha_inicio, poliza_origen_id')
          .in('poliza_origen_id', polizaIds)
          .in('estado', ['RENOVADA', 'PROGRAMADA'])
      : { data: [] as any[] }
    const mapRenovacionPendiente = new Map<string, { fecha_inicio: string; numero_poliza: string }>()
    for (const r of ((renovacionesData ?? []) as any[])) {
      if (!r.poliza_origen_id) continue
      // Si hay varias por accidente, quedamos con la más temprana (menor fecha_inicio).
      const anterior = mapRenovacionPendiente.get(r.poliza_origen_id)
      if (!anterior || r.fecha_inicio < anterior.fecha_inicio) {
        mapRenovacionPendiente.set(r.poliza_origen_id, {
          fecha_inicio: r.fecha_inicio,
          numero_poliza: r.numero_poliza,
        })
      }
    }

    // Enriquecer pólizas con datos y archivos
    const polizasResult = await Promise.all(
      polizasArr.map(async p => {
        const archivos = await listarDocumentacionPoliza(p.numero_poliza)
        return {
          id: p.id,
          numero_poliza: p.numero_poliza,
          compania: p.compania_id ? mapCompania.get(p.compania_id) || '' : '',
          ramo: p.ramo_id ? mapRamo.get(p.ramo_id) || '' : '',
          cobertura: p.cobertura_id ? mapCobertura.get(p.cobertura_id) || '' : '',
          // Suma asegurada solo se expone si el PAS marcó el toggle en la
          // ficha. Default false (oculto) — evita que el cliente vea un valor
          // desactualizado en seguros donde la suma cambia mes a mes (auto).
          suma_asegurada: p.mostrar_suma_asegurada_portal ? (p.suma_asegurada ?? null) : null,
          moneda: p.moneda || 'ARS',
          fecha_inicio: p.fecha_inicio,
          fecha_fin: p.fecha_fin,
          riesgos: mapRiesgos.get(p.id) ?? [],
          // Observaciones son intencionalmente visibles al asegurado (a
          // diferencia de `notas` que son privadas del PAS y NO se exponen).
          observaciones: p.observaciones || null,
          archivos,
          // Renovación pendiente (badge informativo en la card). Solo si el
          // PAS ya emitió la nueva póliza y quedó latente esperando su fecha
          // de inicio. Ver [[patron-renovacion-badge-portal]].
          renovacion_pendiente: mapRenovacionPendiente.get(p.id) ?? null,
        }
      })
    )

    // 6. Todos los siniestros del asegurado (incluye finalizados/rechazados como antecedentes)
    const { data: siniestros } = await supabase
      .from('siniestros')
      .select('id, numero_caso, numero_siniestro, estado, fecha_denuncia, descripcion, tipo_siniestro, detalle_siniestro, poliza_id')
      .eq('persona_id', personaId)
      .is('deleted_at', null)
      .order('fecha_denuncia', { ascending: false })

    const siniestrosArr = (siniestros ?? []) as any[]
    const siniestroIds = siniestrosArr.map(s => s.id)

    // Bitácora pública: cambios de estado + notas que el PAS deja para el asegurado
    const { data: bitacora } = siniestroIds.length
      ? await supabase
          .from('siniestro_bitacora')
          .select('siniestro_id, tipo, texto, estado_anterior, estado_nuevo, created_at')
          .in('siniestro_id', siniestroIds)
          .in('tipo', ['ESTADO', 'NOTA'])
          .order('created_at', { ascending: true })
      : { data: [] as any[] }

    const mapBitacora = new Map<string, any[]>()
    for (const b of ((bitacora ?? []) as any[])) {
      if (!mapBitacora.has(b.siniestro_id)) mapBitacora.set(b.siniestro_id, [])
      mapBitacora.get(b.siniestro_id)!.push({
        tipo: b.tipo,
        texto: b.texto,
        estado_anterior: b.estado_anterior,
        estado_nuevo: b.estado_nuevo,
        fecha: b.created_at,
      })
    }

    // Traer los primeros riesgos de las pólizas asociadas a siniestros para
    // que cada card de siniestro pueda mostrar el bien asegurado (auto, casa,
    // etc.) como referencia. Ver task 8d del rediseño del portal.
    const polizasIdsSiniestros = Array.from(new Set(siniestrosArr.map(s => s.poliza_id).filter(Boolean)))
    const { data: riesgosSiniestros } = polizasIdsSiniestros.length
      ? await supabase
          .from('riesgos')
          .select('poliza_id, tipo_riesgo, detalle_tecnico, descripcion_corta')
          .in('poliza_id', polizasIdsSiniestros)
          .order('numero_item', { ascending: true })
      : { data: [] as any[] }
    // 1 riesgo por póliza — el primero (numero_item más chico). Alcanza para
    // mostrar la referencia visual en la card.
    const mapPrimerRiesgo = new Map<string, any>()
    for (const r of ((riesgosSiniestros ?? []) as any[])) {
      if (!mapPrimerRiesgo.has(r.poliza_id)) mapPrimerRiesgo.set(r.poliza_id, r)
    }
    // Nombres de compañía por póliza (para el sub-header en la card).
    const mapCompaniaPorPoliza = new Map<string, string>()
    for (const p of ((polizas ?? []) as any[])) {
      if (p.compania_id) mapCompaniaPorPoliza.set(p.id, mapCompania.get(p.compania_id) || '')
    }

    const siniestrosResult = await Promise.all(
      siniestrosArr.map(async s => {
        const riesgo = s.poliza_id ? mapPrimerRiesgo.get(s.poliza_id) : null
        return {
          id: s.id,
          numero_caso: s.numero_caso,
          numero_siniestro: s.numero_siniestro,
          estado: s.estado,
          fecha_denuncia: s.fecha_denuncia,
          tipo_siniestro: s.tipo_siniestro,
          tipo_otro_descripcion: s.detalle_siniestro?.tipo_otro_descripcion ?? null,
          timeline: mapBitacora.get(s.id) ?? [],
          archivos: await listarDocumentacionSiniestro(s.numero_caso),
          // NUEVO — bien asegurado para mostrar en la card del portal
          compania_nombre: s.poliza_id ? (mapCompaniaPorPoliza.get(s.poliza_id) || null) : null,
          bien_asegurado: riesgo ? {
            tipo_riesgo: riesgo.tipo_riesgo || null,
            detalle_tecnico: riesgo.detalle_tecnico || {},
            descripcion_corta: riesgo.descripcion_corta || null,
          } : null,
        }
      })
    )

    // 7. Teléfonos de asistencia de compañías con pólizas del cliente
    const { data: telefonos } = companiaIds.length
      ? await supabase
          .from('telefonos_asistencia_companias')
          .select('compania_id, telefono, nombre_boton, telefono_2, nombre_boton_2, visible_en_portal')
          .in('compania_id', companiaIds)
          .eq('visible_en_portal', true)
      : { data: [] as any[] }

    const telefonosResult = ((telefonos ?? []) as any[]).map(t => ({
      compania_id: t.compania_id,
      compania: mapCompania.get(t.compania_id) || '',
      telefono: t.telefono,
      nombre_boton: t.nombre_boton,
      telefono_2: t.telefono_2 || null,
      nombre_boton_2: t.nombre_boton_2 || null,
    }))

    // 8. Datos del productor
    const { data: organizacion } = await supabase
      .from('configuracion')
      .select('nombre, telefono, whatsapp, email, logo_path, color_marca, matricula_ssn, usar_logo')
      .limit(1)
      .maybeSingle()

    // 9. Respuesta
    const p = persona as any
    // Nombre para mostrar: primer nombre (FISICA) o razón social (JURIDICA).
    const primerNombre = p.nombre ? String(p.nombre).split(/\s+/)[0] : ''
    const nombreMostrar =
      p.tipo_persona === 'JURIDICA'
        ? p.razon_social || p.apellido
        : primerNombre || p.apellido
    const nombreCompleto =
      p.tipo_persona === 'JURIDICA'
        ? p.razon_social || p.apellido
        : [p.nombre, p.apellido].filter(Boolean).join(' ')
    const prod = (organizacion as any) ?? {}

    return NextResponse.json({
      ok: true,
      cliente: {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        razon_social: p.razon_social,
        tipo_persona: p.tipo_persona,
        nombre_mostrar: nombreMostrar,
        nombre_completo: nombreCompleto,
        email: p.email || '',
        email_secundario: p.email_secundario || '',
        telefono: p.telefono || '',
        telefono_secundario: p.telefono_secundario || '',
        whatsapp: p.whatsapp || '',
        direccion: {
          calle: p.calle || '',
          numero: p.numero || '',
          piso_depto: p.piso_depto || '',
          barrio: p.barrio || '',
          localidad: p.localidad || '',
          provincia: p.provincia || '',
          codigo_postal: p.codigo_postal || '',
        },
      },
      polizas: polizasResult,
      siniestros: siniestrosResult,
      telefonos_asistencia: telefonosResult,
      organizacion: {
        nombre: prod.nombre || '',
        telefono: prod.telefono || '',
        whatsapp: prod.whatsapp || '',
        email: prod.email || '',
        logo_path: prod.usar_logo !== false && prod.logo_path ? prod.logo_path : null,
        color_marca: prod.color_marca || null,
        matriculado: !!(prod.matricula_ssn && String(prod.matricula_ssn).trim()),
      },
      portal: {
        texto_bienvenida: configuracion.texto_bienvenida,
      },
    })
  } catch (err: any) {
    logger.error({ modulo: 'portal-cliente', mensaje: 'Error al validar token del portal', contexto: { error: err?.message } })
    return NextResponse.json(
      { ok: false, error: 'Error interno. Intentá nuevamente.' },
      { status: 500 }
    )
  }
}
