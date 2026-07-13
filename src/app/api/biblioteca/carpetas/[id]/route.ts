import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import { eliminarArchivoBiblioteca } from '@/lib/biblioteca-storage'

/**
 * PATCH /api/biblioteca/carpetas/[id]
 * Body: { nombre?, parent_id? }
 * Renombrar o mover la carpeta. parent_id=null la mueve a raíz.
 * No permite mover una carpeta dentro de sí misma o de una descendiente
 * (previene ciclos).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const body = await request.json().catch(() => ({}))
  const { id } = params
  const patch: any = {}

  if ('nombre' in body) {
    const nombre = String(body.nombre ?? '').trim()
    if (!nombre) {
      return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío' }, { status: 400 })
    }
    if (nombre.length > 120) {
      return NextResponse.json({ ok: false, error: 'El nombre no puede superar 120 caracteres' }, { status: 400 })
    }
    patch.nombre = nombre
  }

  if ('parent_id' in body) {
    const nuevoParent = body.parent_id ?? null

    // No auto-referencia.
    if (nuevoParent === id) {
      return NextResponse.json({ ok: false, error: 'Una carpeta no puede ser su propio padre' }, { status: 400 })
    }

    // Anti-ciclo: si nuevoParent es descendiente de id, rechazar.
    if (nuevoParent) {
      const supabase = getSupabaseAdmin()
      const descendientes = await obtenerDescendientes(supabase, id)
      if (descendientes.has(nuevoParent)) {
        return NextResponse.json(
          { ok: false, error: 'No se puede mover una carpeta dentro de una de sus descendientes' },
          { status: 400 }
        )
      }
    }

    patch.parent_id = nuevoParent
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Sin cambios' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('biblioteca_carpetas')
    .update(patch)
    .eq('id', id)
    .select('id, nombre, parent_id, orden, updated_at')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'Ya existe una carpeta con ese nombre en este nivel' },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Carpeta no encontrada' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, carpeta: data })
}

/**
 * DELETE /api/biblioteca/carpetas/[id]
 * Elimina la carpeta. CASCADE en DB borra las subcarpetas.
 * Los archivos hijos quedan huérfanos (carpeta_id = NULL → van a la raíz).
 * Este endpoint NO borra archivos físicos — solo la fila de la carpeta.
 * Si el user quiere borrar todo, tiene que borrar los archivos primero.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  const supabase = getSupabaseAdmin()

  // Chequear si hay archivos dentro (directos o en subcarpetas). Si hay,
  // avisar al user antes de borrar.
  const descendientes = await obtenerDescendientes(supabase, params.id)
  const carpetasAConsultar = [params.id, ...Array.from(descendientes)]

  const { count } = await supabase
    .from('biblioteca_archivos')
    .select('id', { count: 'exact', head: true })
    .in('carpeta_id', carpetasAConsultar)

  const url = new URL(request.url)
  const forzar = url.searchParams.get('forzar') === '1'

  if ((count ?? 0) > 0 && !forzar) {
    return NextResponse.json(
      {
        ok: false,
        error: 'CARPETA_CON_ARCHIVOS',
        mensaje: `La carpeta contiene ${count} archivo(s) directamente o en subcarpetas. Pasá ?forzar=1 para eliminar todo.`,
        cantidad: count,
      },
      { status: 409 }
    )
  }

  // Si va con ?forzar=1, borrar archivos físicos + fila DB (CASCADE hace lo demás).
  if (forzar && (count ?? 0) > 0) {
    const { data: archivos } = await supabase
      .from('biblioteca_archivos')
      .select('id, ruta')
      .in('carpeta_id', carpetasAConsultar)

    for (const a of archivos ?? []) {
      await eliminarArchivoBiblioteca(a.ruta)
    }
    await supabase.from('biblioteca_archivos').delete().in('id', (archivos ?? []).map(a => a.id))
  }

  const { error } = await supabase.from('biblioteca_carpetas').delete().eq('id', params.id)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/** Devuelve el set de ids de descendientes de una carpeta (recursivo). */
async function obtenerDescendientes(supabase: any, carpetaId: string): Promise<Set<string>> {
  const descendientes = new Set<string>()
  let cola: string[] = [carpetaId]
  while (cola.length > 0) {
    const { data } = await supabase
      .from('biblioteca_carpetas')
      .select('id')
      .in('parent_id', cola)
    const ids = (data ?? []).map((r: any) => r.id)
    for (const id of ids) descendientes.add(id)
    cola = ids
  }
  return descendientes
}
