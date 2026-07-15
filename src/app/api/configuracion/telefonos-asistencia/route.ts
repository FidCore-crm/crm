import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

async function obtenerTipoCompaniaId(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from('tipo_catalogo')
    .select('id, codigo')
    .eq('codigo', 'COMPANIA')
    .maybeSingle()
  return data ? (data as any).id : null
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const supabase = getSupabaseAdmin()
  const tipoId = await obtenerTipoCompaniaId(supabase)
  if (!tipoId) {
    return NextResponse.json({ ok: true, companias: [] })
  }

  const [{ data: companias }, { data: telefonos }] = await Promise.all([
    supabase
      .from('catalogos')
      .select('id, nombre')
      .eq('tipo_id', tipoId)
      .eq('activo', true)
      .order('nombre', { ascending: true }),
    supabase.from('telefonos_asistencia_companias').select('*'),
  ])

  const mapTel = new Map<string, any>()
  for (const t of (telefonos ?? []) as any[]) {
    mapTel.set(t.compania_id, t)
  }

  const resultado = (companias ?? []).map((c: any) => {
    const tel = mapTel.get(c.id)
    return {
      compania_id: c.id,
      compania_nombre: c.nombre,
      tiene_config: !!tel,
      id: tel?.id ?? null,
      telefono: tel?.telefono ?? null,
      nombre_boton: tel?.nombre_boton ?? null,
      telefono_2: tel?.telefono_2 ?? null,
      nombre_boton_2: tel?.nombre_boton_2 ?? null,
      visible_en_portal: tel?.visible_en_portal ?? null,
    }
  })

  return NextResponse.json({ ok: true, companias: resultado })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const compania_id: string | undefined = body?.compania_id
    const telefono: string | undefined = body?.telefono
    const nombre_boton: string = body?.nombre_boton || 'Asistencia 24hs'
    const telefono_2: string | undefined = body?.telefono_2
    const nombre_boton_2: string | undefined = body?.nombre_boton_2
    const visible_en_portal: boolean = body?.visible_en_portal !== false

    if (!compania_id) {
      return NextResponse.json({ ok: false, error: 'compania_id es requerido' }, { status: 400 })
    }
    if (!telefono || !String(telefono).trim()) {
      return NextResponse.json({ ok: false, error: 'El teléfono es requerido' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('telefonos_asistencia_companias')
      .upsert(
        {
          compania_id,
          telefono: String(telefono).trim(),
          nombre_boton: String(nombre_boton).trim() || 'Asistencia 24hs',
          telefono_2: telefono_2 && String(telefono_2).trim() ? String(telefono_2).trim() : null,
          nombre_boton_2: nombre_boton_2 && String(nombre_boton_2).trim() ? String(nombre_boton_2).trim() : null,
          visible_en_portal,
        } as any,
        { onConflict: 'compania_id' }
      )
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, telefono: data })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
