import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type {
  EntidadesRegistro,
  PersonaImportada,
  RegistroProcesado,
} from '@/lib/importacion/types'

export const dynamic = 'force-dynamic'

// ¿Esta persona tiene más datos que la otra? Usamos completitud para decidir
// cuál registro mostrar cuando el mismo DNI aparece en varios lotes (típico:
// archivo Clientes tiene apellido/nombre, archivo Pólizas tiene solo DNI).
function completitudPersona(p: PersonaImportada | null | undefined): number {
  if (!p) return 0
  let score = 0
  if (p.apellido) score += 3
  if (p.nombre) score += 2
  if (p.razon_social) score += 3
  if (p.email) score += 1
  if (p.telefono) score += 1
  if (p.calle) score += 1
  if (p.localidad) score += 1
  return score
}

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const url = new URL(request.url)
  const limite = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limite') || '10', 10)))

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  const own = requireOwnership(usuario, { usuario_id: (imp as { usuario_id: string }).usuario_id })
  if (own) return own

  const { data: lotes, error: errLotes } = await supabase
    .from('importacion_lotes')
    .select('numero_lote, registros_procesados_data')
    .eq('importacion_id', id)
    .eq('estado', 'COMPLETADO')
    .order('numero_lote', { ascending: true })

  if (errLotes) {
    return NextResponse.json({ ok: false, error: errLotes.message }, { status: 500 })
  }

  type LoteRow = { numero_lote: number; registros_procesados_data: RegistroProcesado[] | null }

  // Fase 1: recolectar TODOS los registros de todos los lotes.
  const todos: RegistroProcesado[] = []
  for (const l of ((lotes ?? []) as LoteRow[])) {
    const data = l.registros_procesados_data
    if (!Array.isArray(data)) continue
    for (const r of data) {
      todos.push(r)
    }
  }

  // Fase 2: indexar por DNI. Por cada DNI guardamos:
  //  - La persona "más completa" vista (típicamente la del archivo Clientes).
  //  - Todos los registros que tienen póliza (típicamente del archivo Pólizas).
  type GrupoDni = {
    personaMejor: PersonaImportada | null
    polizasYRiesgos: RegistroProcesado[]
    registroSoloPersona: RegistroProcesado | null
  }
  const porDni = new Map<string, GrupoDni>()

  for (const r of todos) {
    const dni = String((r.entidades?.persona?.dni_cuil ?? '') as string).trim()
    if (!dni) continue
    let grupo = porDni.get(dni)
    if (!grupo) {
      grupo = { personaMejor: null, polizasYRiesgos: [], registroSoloPersona: null }
      porDni.set(dni, grupo)
    }
    const persona = r.entidades?.persona ?? null
    if (
      persona &&
      completitudPersona(persona) > completitudPersona(grupo.personaMejor)
    ) {
      grupo.personaMejor = persona
    }
    if (r.entidades?.poliza) {
      grupo.polizasYRiesgos.push(r)
    } else if (!grupo.registroSoloPersona) {
      grupo.registroSoloPersona = r
    }
  }

  // Fase 3: construir registros fusionados. Una fila por póliza si hay pólizas,
  // o una fila por persona si solo tiene persona. La persona siempre es la
  // "más completa" disponible para ese DNI.
  const registros: RegistroProcesado[] = []
  for (const [, grupo] of Array.from(porDni.entries())) {
    if (registros.length >= limite) break
    const personaFusionada = grupo.personaMejor

    if (grupo.polizasYRiesgos.length > 0) {
      for (const pr of grupo.polizasYRiesgos) {
        if (registros.length >= limite) break
        const entidades: EntidadesRegistro = {
          persona: personaFusionada,
          poliza: pr.entidades?.poliza ?? null,
          riesgo: pr.entidades?.riesgo ?? null,
        }
        registros.push({
          ...pr,
          entidades,
        })
      }
    } else if (grupo.registroSoloPersona) {
      registros.push({
        ...grupo.registroSoloPersona,
        entidades: {
          persona: personaFusionada,
          poliza: null,
          riesgo: null,
        },
      })
    }
  }

  return NextResponse.json({
    ok: true,
    registros,
    total_mostrados: registros.length,
  })
}
