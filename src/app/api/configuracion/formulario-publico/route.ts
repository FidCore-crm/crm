import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUrlFormularioPublico, validarUrlPublica } from '@/lib/urls-publicas'

export async function GET(request: Request) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario || usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()
  let { data } = await supabase
    .from('configuracion_formulario_publico')
    .select('*')
    .limit(1)
    .maybeSingle()

  // Si no existe, crear fila por defecto
  if (!data) {
    const { data: nuevo } = await supabase
      .from('configuracion_formulario_publico')
      .insert({
        activo: true,
        titulo_hero: 'Denunciar Siniestro',
        subtitulo_hero: 'Completá los datos de tu siniestro de forma rápida y segura. Te llegará una constancia por email.',
      })
      .select('*')
      .single()
    data = nuevo
  }

  const urlPublica = await obtenerUrlFormularioPublico()

  return NextResponse.json({ ok: true, configuracion: { ...data, url_publica: urlPublica } })
}

export async function PATCH(request: Request) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario || usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const supabase = getSupabaseAdmin()

    // Validaciones
    if (body.titulo_hero !== undefined && !body.titulo_hero?.trim()) {
      return NextResponse.json({ ok: false, error: 'El título no puede estar vacío' }, { status: 400 })
    }
    if (body.mensaje_validacion_fallida !== undefined && !body.mensaje_validacion_fallida?.trim()) {
      return NextResponse.json({ ok: false, error: 'El mensaje de validación no puede estar vacío' }, { status: 400 })
    }
    if (body.mensaje_fuera_servicio !== undefined && !body.mensaje_fuera_servicio?.trim()) {
      return NextResponse.json({ ok: false, error: 'El mensaje de fuera de servicio no puede estar vacío' }, { status: 400 })
    }
    if (body.terminos_activos === true && !body.terminos_contenido?.trim()) {
      return NextResponse.json({ ok: false, error: 'Si activás los términos, tenés que completar el contenido' }, { status: 400 })
    }

    // La URL del formulario vive en `configuracion.url_formulario_publico`
    // (no en `configuracion_formulario_publico`). Si vino, la validamos.
    let urlFormularioNormalizada: string | null | undefined
    if (body.url_publica !== undefined) {
      const v = validarUrlPublica(body.url_publica)
      if (!v.valido) {
        return NextResponse.json({ ok: false, error: v.motivo }, { status: 400 })
      }
      urlFormularioNormalizada = v.normalizada
    }

    // Obtener o crear la fila
    const { data: existing } = await supabase
      .from('configuracion_formulario_publico')
      .select('id')
      .limit(1)
      .maybeSingle()

    const campos: Record<string, any> = {}
    const allowed = [
      'activo', 'titulo_hero', 'subtitulo_hero',
      'mensaje_validacion_fallida', 'mensaje_fuera_servicio',
      'terminos_activos', 'terminos_titulo', 'terminos_contenido',
    ]
    for (const key of allowed) {
      if (body[key] !== undefined) {
        campos[key] = body[key]
      }
    }

    let data
    if (existing) {
      const { data: updated, error } = await supabase
        .from('configuracion_formulario_publico')
        .update(campos)
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
      data = updated
    } else {
      const { data: created, error } = await supabase
        .from('configuracion_formulario_publico')
        .insert(campos)
        .select('*')
        .single()
      if (error) return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })
      data = created
    }

    if (urlFormularioNormalizada !== undefined) {
      const { data: cfgRow } = await supabase
        .from('configuracion')
        .select('id')
        .limit(1)
        .maybeSingle()
      if (cfgRow?.id) {
        const { error: errUrl } = await supabase
          .from('configuracion')
          .update({ url_formulario_publico: urlFormularioNormalizada })
          .eq('id', cfgRow.id)
        if (errUrl) {
          return NextResponse.json({ ok: false, error: 'Error al guardar la URL del formulario' }, { status: 500 })
        }
      } else {
        return NextResponse.json({ ok: false, error: 'No existe el registro de configuración global. Completá el perfil de la organización primero.' }, { status: 400 })
      }
    }

    const urlPublica = await obtenerUrlFormularioPublico()
    return NextResponse.json({ ok: true, configuracion: { ...data, url_publica: urlPublica } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
