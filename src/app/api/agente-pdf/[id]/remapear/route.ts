import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { mapearCatalogos } from '@/lib/agente-pdf/mapeador-catalogos'
import { validarDatosExtraidosPoliza } from '@/lib/agente-pdf/validador'
import type { DatosExtraidosPoliza, TipoOperacionPDF } from '@/lib/agente-pdf/types'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Re-ejecuta el mapeo de catálogos sobre los datos ya extraídos del PDF.
 * Pensado para cuando el PAS configura una cobertura nueva en Catálogos
 * y quiere que el sistema la reconozca sin reprocesar el PDF con la IA.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data: proc } = await supabase
    .from('pdf_procesamientos')
    .select('id, tipo_operacion, poliza_origen_id, estado, datos_extraidos, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (!proc) {
    return NextResponse.json({ ok: false, error: 'Procesamiento no encontrado' }, { status: 404 })
  }

  const owns = requireOwnership(auth, { usuario_id: (proc as any).usuario_id })
  if (owns) return owns

  if ((proc as any).estado !== 'EXTRAIDO') {
    return NextResponse.json(
      { ok: false, error: `Solo se puede remapear en estado EXTRAIDO (actual: ${(proc as any).estado})` },
      { status: 400 }
    )
  }

  const tipoOperacion = (proc as any).tipo_operacion as TipoOperacionPDF
  if (tipoOperacion === 'ENDOSO') {
    return NextResponse.json(
      { ok: false, error: 'Los endosos no tienen mapeo de catálogos' },
      { status: 400 }
    )
  }

  const datos = (proc as any).datos_extraidos as DatosExtraidosPoliza
  if (!datos) {
    return NextResponse.json({ ok: false, error: 'No hay datos extraídos para remapear' }, { status: 400 })
  }

  // Re-ejecutar mapeo y revalidar
  const mapeos = await mapearCatalogos(datos)

  // Recalcular dudosos (respetando eventual contexto de póliza origen)
  let contexto: { poliza_origen_dni_cuil?: string; poliza_origen_numero?: string } | undefined
  if ((proc as any).poliza_origen_id) {
    const { data: origen } = await supabase
      .from('polizas')
      .select('numero_poliza, asegurado:personas!asegurado_id (dni_cuil)')
      .eq('id', (proc as any).poliza_origen_id)
      .maybeSingle()
    if (origen) {
      contexto = {
        poliza_origen_numero: (origen as any).numero_poliza,
        poliza_origen_dni_cuil: (origen as any).asegurado?.dni_cuil,
      }
    }
  }

  const dudosos = validarDatosExtraidosPoliza(datos, mapeos, tipoOperacion, contexto)

  await supabase
    .from('pdf_procesamientos')
    .update({
      mapeos_catalogos: mapeos as any,
      campos_dudosos: dudosos as any,
    } as any)
    .eq('id', id)

  return NextResponse.json({ ok: true, mapeos, campos_dudosos: dudosos })
}
