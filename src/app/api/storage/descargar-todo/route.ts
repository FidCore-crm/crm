/**
 * GET /api/storage/descargar-todo
 *
 * Genera un ZIP con todos los archivos de una entidad (siniestro o póliza) y
 * lo devuelve como stream. Uso principal: botón "Descargar todo" en el
 * GestorArchivos de la ficha de siniestro (v1.0.126) — antes el PAS tenía
 * que bajar los archivos uno por uno.
 *
 * Query params:
 *   - tipo: 'siniestro' | 'poliza'  (requerido)
 *   - id: UUID de la entidad         (requerido)
 *   - categoria: 'documentacion' | 'inspeccion' | 'endosos' (default 'documentacion')
 *
 * Response:
 *   - 200 application/zip con nombre `<Prefijo>-<numero>-<categoria>.zip`
 *   - 401/403 según permisos
 *   - 404 si la entidad no existe o no hay archivos
 *
 * Sin límite de tamaño total — el JSON.zip corre en memoria del container.
 * Si en algún cliente los archivos superan 500 MB conviene reevaluar
 * streaming, pero para el volumen típico de un siniestro (2-20 MB de fotos +
 * PDFs) alcanza sobrado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tipo = searchParams.get('tipo')
  const id = searchParams.get('id')
  const categoria = (searchParams.get('categoria') ?? 'documentacion').replace(/[^a-z_]/g, '')

  if (!tipo || !id) {
    return NextResponse.json({ ok: false, error: 'Faltan parámetros: tipo, id' }, { status: 400 })
  }
  if (tipo !== 'siniestro' && tipo !== 'poliza') {
    return NextResponse.json({ ok: false, error: 'Tipo inválido' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // ── Cargar archivos + verificar ownership ─────────────
  let archivos: Array<{ nombre: string; ruta: string }> = []
  let nombreBase = ''

  if (tipo === 'siniestro') {
    const { data: sin, error: sinErr } = await supabase
      .from('siniestros')
      .select('id, numero_caso, persona:personas!persona_id(usuario_id)')
      .eq('id', id)
      .maybeSingle()
    if (sinErr || !sin) {
      return NextResponse.json({ ok: false, error: 'Siniestro no encontrado' }, { status: 404 })
    }
    // Filtro de cartera: PROPIA solo ve los suyos.
    if (usuario.acceso_cartera === 'PROPIA') {
      const usuarioIdPersona = (sin as any).persona?.usuario_id
      if (usuarioIdPersona && usuarioIdPersona !== usuario.id) {
        return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
      }
    }
    const { data: archivosDB } = await supabase
      .from('siniestro_archivos')
      .select('nombre, ruta')
      .eq('siniestro_id', id)
      .eq('categoria', categoria)
      .order('created_at', { ascending: true })
    archivos = (archivosDB ?? []) as Array<{ nombre: string; ruta: string }>
    nombreBase = `Siniestro-${(sin as any).numero_caso}`
  } else {
    // tipo === 'poliza'
    const { data: pol, error: polErr } = await supabase
      .from('polizas')
      .select('id, numero_poliza, asegurado:personas!asegurado_id(usuario_id)')
      .eq('id', id)
      .maybeSingle()
    if (polErr || !pol) {
      return NextResponse.json({ ok: false, error: 'Póliza no encontrada' }, { status: 404 })
    }
    if (usuario.acceso_cartera === 'PROPIA') {
      const usuarioIdPersona = (pol as any).asegurado?.usuario_id
      if (usuarioIdPersona && usuarioIdPersona !== usuario.id) {
        return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
      }
    }
    const { data: archivosDB } = await supabase
      .from('poliza_archivos')
      .select('nombre, ruta')
      .eq('poliza_id', id)
      .eq('categoria', categoria)
      .order('created_at', { ascending: true })
    archivos = (archivosDB ?? []) as Array<{ nombre: string; ruta: string }>
    nombreBase = `Poliza-${(pol as any).numero_poliza}`
  }

  if (archivos.length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay archivos para descargar' }, { status: 404 })
  }

  // ── Armar ZIP ─────────────────────────────────────────
  const zip = new JSZip()
  const nombresUsados = new Map<string, number>() // para deduplicar nombres iguales

  for (const arch of archivos) {
    // Validación de ruta: nunca leer fuera de STORAGE_ROOT.
    const rutaAbs = path.isAbsolute(arch.ruta) ? arch.ruta : path.join(STORAGE_ROOT, arch.ruta)
    const rutaResuelta = path.resolve(rutaAbs)
    if (!rutaResuelta.startsWith(STORAGE_ROOT + path.sep) && rutaResuelta !== STORAGE_ROOT) {
      logger.warn({ modulo: 'storage', mensaje: 'Ruta fuera de STORAGE_ROOT en descargar-todo', contexto: { ruta: arch.ruta } })
      continue
    }
    if (!existsSync(rutaResuelta)) {
      logger.warn({ modulo: 'storage', mensaje: 'Archivo no existe en disco', contexto: { ruta: arch.ruta } })
      continue
    }
    try {
      const buffer = await readFile(rutaResuelta)
      // Deduplicar nombres iguales dentro del ZIP (ej: 2 archivos "foto.jpg").
      let nombreZip = arch.nombre
      const usos = nombresUsados.get(nombreZip.toLowerCase()) ?? 0
      if (usos > 0) {
        const ext = path.extname(nombreZip)
        const base = nombreZip.slice(0, nombreZip.length - ext.length)
        nombreZip = `${base}-${usos + 1}${ext}`
      }
      nombresUsados.set(arch.nombre.toLowerCase(), usos + 1)
      zip.file(nombreZip, buffer)
    } catch (err: any) {
      logger.warn({ modulo: 'storage', mensaje: 'Fallo lectura archivo para ZIP', contexto: { ruta: arch.ruta, error: err.message } })
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const nombreZip = `${nombreBase}-${categoria}.zip`

  return new NextResponse(zipBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombreZip}"`,
      'Content-Length': String(zipBuffer.length),
    },
  })
}
