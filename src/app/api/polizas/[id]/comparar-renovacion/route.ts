import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { iniciarComparacionEnBackground } from '@/lib/agente-pdf/comparador-background'
import { logger } from '@/lib/errores'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Dispara manualmente la comparación IA entre esta póliza (renovación) y una
 * póliza anterior. Se usa cuando:
 *   - La póliza origen es legacy (no tiene archivo con es_poliza_principal),
 *     el PAS elige cuál PDF usar como "el viejo".
 *   - La comparación auto falló y el PAS quiere reintentar.
 *
 * Body: { archivo_viejo_id: string }
 * El archivo debe pertenecer a la póliza origen (poliza_origen_id).
 *
 * Efecto:
 *   1. Marca el archivo elegido como es_poliza_principal=true (aprende para
 *      futuras renovaciones).
 *   2. Busca el PDF de esta póliza (archivo con categoría documentacion o
 *      documentacion_renovada más reciente).
 *   3. Dispara compararPolizasConIA en background.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const { id: polizaNuevaId } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const archivoViejoId = typeof body?.archivo_viejo_id === 'string' ? body.archivo_viejo_id : null
  if (!archivoViejoId) {
    return NextResponse.json(
      { ok: false, error: 'Falta archivo_viejo_id en el body' },
      { status: 400 },
    )
  }

  const supabase = getSupabaseAdmin()

  // 1. Validar que la póliza sea una renovación
  const { data: polizaNueva } = await supabase
    .from('polizas')
    .select('id, poliza_origen_id')
    .eq('id', polizaNuevaId)
    .maybeSingle()

  if (!polizaNueva) {
    return NextResponse.json({ ok: false, error: 'Póliza no encontrada' }, { status: 404 })
  }
  const polizaOrigenId = (polizaNueva as any).poliza_origen_id as string | null
  if (!polizaOrigenId) {
    return NextResponse.json(
      { ok: false, error: 'Esta póliza no es una renovación — no hay póliza anterior con la que comparar.' },
      { status: 400 },
    )
  }

  // 2. Validar que el archivo elegido pertenezca a la póliza origen
  const { data: archivoViejo } = await supabase
    .from('poliza_archivos')
    .select('id, poliza_id')
    .eq('id', archivoViejoId)
    .maybeSingle()

  if (!archivoViejo || (archivoViejo as any).poliza_id !== polizaOrigenId) {
    return NextResponse.json(
      { ok: false, error: 'El archivo elegido no pertenece a la póliza anterior.' },
      { status: 400 },
    )
  }

  // 3. Buscar el PDF de esta póliza — priorizamos documentacion_renovada
  // (aún no activó la renovación) y luego documentacion (ya activó).
  const { data: archivosNueva } = await supabase
    .from('poliza_archivos')
    .select('id, categoria, created_at')
    .eq('poliza_id', polizaNuevaId)
    .in('categoria', ['documentacion_renovada', 'documentacion'])
    .order('created_at', { ascending: false })

  const archivoNuevo = (archivosNueva || []).find(a => (a as any).categoria === 'documentacion_renovada')
    || (archivosNueva || []).find(a => (a as any).categoria === 'documentacion')

  if (!archivoNuevo) {
    return NextResponse.json(
      { ok: false, error: 'No se encontró el PDF de esta renovación para comparar.' },
      { status: 400 },
    )
  }
  const archivoNuevoId = (archivoNuevo as any).id as string

  // 4. Marcar el archivo elegido como es_poliza_principal (aprendizaje para
  // futuras renovaciones — la próxima vez no hace falta preguntar).
  //    Primero desmarcamos cualquier otro principal de la póliza origen.
  try {
    await supabase
      .from('poliza_archivos')
      .update({ es_poliza_principal: false } as any)
      .eq('poliza_id', polizaOrigenId)
      .eq('es_poliza_principal', true)

    await supabase
      .from('poliza_archivos')
      .update({ es_poliza_principal: true } as any)
      .eq('id', archivoViejoId)
  } catch (err) {
    logger.warn({
      modulo: 'agente-pdf',
      mensaje: 'No se pudo marcar archivo como principal',
      contexto: { archivo_id: archivoViejoId, error: String(err) },
    })
  }

  // 5. Disparar comparación en background
  try {
    void iniciarComparacionEnBackground({
      poliza_nueva_id: polizaNuevaId,
      poliza_origen_id: polizaOrigenId,
      archivo_viejo_id: archivoViejoId,
      archivo_nuevo_id: archivoNuevoId,
      usuario_id: usuario.id,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `No se pudo iniciar la comparación: ${(err as any)?.message || String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, mensaje: 'Comparación iniciada. Te avisamos por notificación cuando termine.' })
}
