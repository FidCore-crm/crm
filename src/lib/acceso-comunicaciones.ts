import { getSupabaseAdmin } from '@/lib/supabase/server'

/**
 * Verifica si el sistema de comunicaciones está activo.
 * Requiere que tanto comunicaciones como correos estén configurados.
 */
export async function sistemaComunicacionesActivo(): Promise<boolean> {
  const supabase = getSupabaseAdmin()

  const [{ data: comConfig }, { data: correoConfig }] = await Promise.all([
    supabase.from('configuracion_comunicaciones').select('activo').limit(1).maybeSingle(),
    supabase.from('configuracion_correos').select('configurado').limit(1).maybeSingle(),
  ])

  const comActivo = (comConfig as any)?.activo === true
  const correoConfigurado = (correoConfig as any)?.configurado === true

  return comActivo && correoConfigurado
}
