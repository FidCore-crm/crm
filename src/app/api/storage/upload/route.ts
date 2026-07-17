import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-auth'
import { logger } from '@/lib/errores'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

const MAX_SIZE = 20 * 1024 * 1024 // 20MB
const STORAGE_ROOT = path.join(process.cwd(), 'storage')

function sanitizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  try {
    const formData = await req.formData()
    const archivo = formData.get('archivo') as File | null
    let categoria = formData.get('categoria') as string

    // Determinar si es póliza, siniestro o perfil
    const polizaId = formData.get('poliza_id') as string | null
    const numeroPoliza = formData.get('numero_poliza') as string | null
    const siniestroId = formData.get('siniestro_id') as string | null
    const numeroCaso = formData.get('numero_caso') as string | null
    const endosoId = formData.get('endoso_id') as string | null
    const esPerfil = formData.get('tipo') === 'perfil'

    const esPoliza = !!polizaId
    const esSiniestro = !!siniestroId

    // Guard de licencia: SOLO bloqueamos uploads de datos del negocio (pólizas,
    // siniestros, endosos). El upload de "perfil" (logo de la organización) se
    // permite siempre porque ocurre durante el wizard de onboarding ANTES de
    // que el PAS cargue su licencia. Bloquearlo dejaría al PAS atrapado.
    if (!esPerfil) {
      const bloqueo = await checkLicenciaActiva()
      if (bloqueo) return bloqueo
    }

    if (!archivo) {
      return NextResponse.json({ ok: false, error: 'Falta el archivo' }, { status: 400 })
    }

    // Upload de logo de perfil — flujo simplificado sin DB.
    //
    // Versionamos el nombre con timestamp para NUNCA sobreescribir el logo
    // anterior. Si algo sale mal (o un script de prueba pisa el archivo),
    // los logos anteriores quedan en disco y se pueden recuperar.
    // El frontend recibe la ruta nueva y actualiza configuracion.logo_path.
    if (esPerfil) {
      if (archivo.size > 2 * 1024 * 1024) {
        return NextResponse.json({ ok: false, error: 'El logo excede el límite de 2MB' }, { status: 400 })
      }
      const nombreSan = sanitizeName(archivo.name)
      const carpeta = path.join(STORAGE_ROOT, 'perfil')
      await mkdir(carpeta, { recursive: true })
      const ext = path.extname(nombreSan).toLowerCase() || '.png'
      // Validación adicional: solo bitmaps. SVG se rechaza porque puede contener
      // <script> y al servirlo con mime image/svg+xml el browser lo ejecuta (XSS).
      // El PAS puede usar PNG con transparencia para el mismo efecto visual.
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        return NextResponse.json({ ok: false, error: 'Formato de logo no soportado. Usá PNG, JPG, WebP o GIF.' }, { status: 400 })
      }
      // Defensa en profundidad: chequear también el mime que reporta el browser.
      const mime = (archivo.type || '').toLowerCase()
      if (mime === 'image/svg+xml' || mime === 'image/svg') {
        return NextResponse.json({ ok: false, error: 'Formato de logo no soportado. Usá PNG, JPG, WebP o GIF.' }, { status: 400 })
      }
      // timestamp en segundos, suficiente para evitar colisiones del mismo PAS
      // y mantener el filename legible.
      const ts = Math.floor(Date.now() / 1000)
      const nombreFinal = `logo-${ts}${ext}`
      const rutaAbsoluta = path.join(carpeta, nombreFinal)
      const buffer = Buffer.from(await archivo.arrayBuffer())
      await writeFile(rutaAbsoluta, buffer)
      const rutaRelativa = `perfil/${nombreFinal}`
      return NextResponse.json({ ok: true, ruta: rutaRelativa })
    }

    if (!categoria || (!esPoliza && !esSiniestro)) {
      return NextResponse.json({ ok: false, error: 'Faltan campos obligatorios' }, { status: 400 })
    }

    if (esPoliza && !['inspeccion', 'documentacion', 'documentacion_renovada', 'endosos'].includes(categoria)) {
      return NextResponse.json({ ok: false, error: 'Categoría inválida para póliza' }, { status: 400 })
    }

    if (esPoliza && categoria === 'endosos' && !endosoId) {
      return NextResponse.json({ ok: false, error: 'Falta endoso_id para categoría endosos' }, { status: 400 })
    }

    if (esSiniestro && !['documentacion', 'documentacion_denuncia', 'fotos'].includes(categoria)) {
      // 'fotos' se mantiene aceptable por retrocompat con clientes viejos
      // que puedan seguir enviándolo, pero se normaliza a 'documentacion'
      // silenciosamente (v1.0.124 unificó las dos categorías).
      // 'documentacion_denuncia' es la que sube el PAS para el asegurado
      // (visible en portal — v1.0.134).
      return NextResponse.json({ ok: false, error: 'Categoría inválida para siniestro' }, { status: 400 })
    }
    // Normalización: cualquier upload que llegue con categoria='fotos' se
    // guarda como 'documentacion' para consolidar todo en un solo lugar.
    if (esSiniestro && categoria === 'fotos') {
      categoria = 'documentacion'
    }

    if (archivo.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: 'El archivo excede el límite de 20MB' }, { status: 400 })
    }

    // ── Verificación de cartera ──────────────────────────────
    if ((usuario as any).acceso_cartera === 'PROPIA') {
      const supabaseCartera = getSupabaseAdmin()
      let personaUserId: string | null = null

      if (esPoliza && polizaId) {
        const { data: poliza } = await supabaseCartera
          .from('polizas')
          .select('asegurado_id')
          .eq('id', polizaId)
          .maybeSingle()
        if (!poliza) {
          return NextResponse.json({ ok: false, error: 'Recurso no encontrado' }, { status: 404 })
        }
        const { data: persona } = await supabaseCartera
          .from('personas')
          .select('usuario_id')
          .eq('id', (poliza as any).asegurado_id)
          .maybeSingle()
        if (persona) personaUserId = (persona as any).usuario_id
      } else if (esSiniestro && siniestroId) {
        const { data: siniestro } = await supabaseCartera
          .from('siniestros')
          .select('persona_id')
          .eq('id', siniestroId)
          .maybeSingle()
        if (!siniestro) {
          return NextResponse.json({ ok: false, error: 'Recurso no encontrado' }, { status: 404 })
        }
        const { data: persona } = await supabaseCartera
          .from('personas')
          .select('usuario_id')
          .eq('id', (siniestro as any).persona_id)
          .maybeSingle()
        if (persona) personaUserId = (persona as any).usuario_id
      }

      if (personaUserId && personaUserId !== (usuario as any).id) {
        return NextResponse.json({ ok: false, error: 'Recurso no encontrado' }, { status: 404 })
      }
    }

    const nombreSanitizado = sanitizeName(archivo.name)

    let carpeta: string
    let rutaRelativa: string

    if (esPoliza) {
      const numSan = sanitizeName(numeroPoliza!)
      if (categoria === 'endosos') {
        // Validar ownership del endoso: debe existir y pertenecer a esta póliza
        const supabaseCheck = getSupabaseAdmin()
        const { data: endoCheck } = await supabaseCheck
          .from('endosos')
          .select('id, poliza_id')
          .eq('id', endosoId!)
          .maybeSingle()
        if (!endoCheck || (endoCheck as any).poliza_id !== polizaId) {
          return NextResponse.json({ ok: false, error: 'Endoso inválido para esta póliza' }, { status: 400 })
        }
        const idSan = sanitizeName(endosoId!)
        carpeta = path.join(STORAGE_ROOT, 'polizas', numSan, 'endosos', idSan)
        rutaRelativa = `polizas/${numSan}/endosos/${idSan}`
      } else {
        carpeta = path.join(STORAGE_ROOT, 'polizas', numSan, categoria)
        rutaRelativa = `polizas/${numSan}/${categoria}`
      }
    } else {
      const numSan = sanitizeName(numeroCaso!)
      carpeta = path.join(STORAGE_ROOT, 'siniestros', numSan, categoria)
      rutaRelativa = `siniestros/${numSan}/${categoria}`
    }

    await mkdir(carpeta, { recursive: true })

    // Si ya existe un archivo con ese nombre, agregar timestamp
    const { existsSync } = require('fs')
    let nombreFinal = nombreSanitizado
    if (existsSync(path.join(carpeta, nombreFinal))) {
      const ext = path.extname(nombreFinal)
      const base = path.basename(nombreFinal, ext)
      nombreFinal = `${base}_${Date.now()}${ext}`
    }

    const rutaAbsoluta = path.join(carpeta, nombreFinal)
    const buffer = Buffer.from(await archivo.arrayBuffer())
    await writeFile(rutaAbsoluta, buffer)

    const rutaFinal = `${rutaRelativa}/${nombreFinal}`
    const supabase = getSupabaseAdmin()

    const tabla = esPoliza ? 'poliza_archivos' : 'siniestro_archivos'
    const fk: Record<string, any> = esPoliza
      ? { poliza_id: polizaId, ...(categoria === 'endosos' ? { endoso_id: endosoId } : {}) }
      : { siniestro_id: siniestroId }

    const { data, error } = await supabase.from(tabla).insert({
      ...fk,
      categoria,
      nombre: nombreFinal,
      ruta: rutaFinal,
      mime_type: archivo.type || null,
      tamano: archivo.size,
    }).select('id, nombre, ruta, categoria').single()

    if (error) {
      logger.error({ modulo: 'storage', mensaje: 'Error al registrar archivo en DB', contexto: { error: error.message } })
      return NextResponse.json({ ok: false, error: 'Error al subir el archivo' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, archivo: data })
  } catch (err: any) {
    logger.error({ modulo: 'storage', mensaje: 'Error inesperado en upload', contexto: { error: err.message } })
    return NextResponse.json({ ok: false, error: 'Error al subir el archivo' }, { status: 500 })
  }
}
