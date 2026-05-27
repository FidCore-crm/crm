import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function generarNumeroCaso(): Promise<string> {
  const supabase = getSupabaseAdmin()

  // Obtener prefijo de la configuración de la organización
  const { data: config } = await supabase
    .from('configuracion')
    .select('prefijo_casos')
    .limit(1)
    .maybeSingle()

  const prefijo = config?.prefijo_casos || 'CASO'

  // Llamar a la función SQL que genera el número atómicamente
  const { data, error } = await supabase.rpc('generar_numero_caso', { prefijo })

  if (error) {
    throw new Error(`Error generando número de caso: ${error.message}`)
  }

  return data as string
}
