import { getSupabaseAdmin } from '@/lib/supabase/server'
import { isAnthropicConfigured } from '@/lib/anthropic-client'

export interface EstadoModuloPDF {
  activo: boolean
  motivo?: string
}

/**
 * Un módulo está "activo" solo si:
 *  - El toggle `modulo_ia_pdf_polizas_activo` está en true
 *  - Hay una API key de Anthropic configurada (DB o env fallback)
 */
export async function checkModuloPDFActivo(): Promise<EstadoModuloPDF> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion')
    .select('modulo_ia_pdf_polizas_activo')
    .limit(1)
    .maybeSingle()

  const toggleOn = !!(data as any)?.modulo_ia_pdf_polizas_activo
  if (!toggleOn) {
    return { activo: false, motivo: 'El módulo está desactivado en Configuración > Agente IA.' }
  }

  const keyOk = await isAnthropicConfigured()
  if (!keyOk) {
    return { activo: false, motivo: 'La API key de Anthropic no está configurada.' }
  }

  return { activo: true }
}
