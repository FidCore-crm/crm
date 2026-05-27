import { getSupabaseAdmin } from '@/lib/supabase/server'

export type TipoNotificacionPDF = 'PDF_LISTO_PARA_REVISAR' | 'PDF_FALLIDO'

export async function notificarPDF(params: {
  procesamiento_id: string
  tipo: TipoNotificacionPDF
  titulo: string
  mensaje: string
  usuario_id: string | null
  url?: string
  prioridad?: 'CRITICA' | 'ADVERTENCIA' | 'INFORMATIVA'
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const prioridad = params.prioridad ||
    (params.tipo === 'PDF_FALLIDO' ? 'CRITICA' : 'ADVERTENCIA')

  await supabase.from('notificaciones').insert({
    tipo: params.tipo,
    prioridad,
    titulo: params.titulo,
    mensaje: params.mensaje,
    entidad_tipo: 'pdf_procesamiento',
    entidad_id: params.procesamiento_id,
    url: params.url || null,
    leida: false,
    usuario_id: params.usuario_id,
  } as any)
}
