import { getSupabaseAdmin } from '@/lib/supabase/server';
import { logger } from '@/lib/errores';

interface ImportacionUsuarioRow {
  usuario_id: string | null;
}

export type TipoNotifImportacion =
  | 'IMPORTACION_INICIADA'
  | 'IMPORTACION_ANALIZADA'
  | 'IMPORTACION_LISTA_REVISION'
  | 'IMPORTACION_COMPLETADA'
  | 'IMPORTACION_FALLIDA'
  | 'IMPORTACION_PAUSADA'
  | 'IMPORTACION_DESHECHA';

export async function notificarImportacion(params: {
  importacion_id: string;
  tipo: TipoNotifImportacion;
  titulo: string;
  mensaje: string;
  prioridad?: 'CRITICA' | 'ADVERTENCIA' | 'INFORMATIVA';
  url?: string;
  usuario_id?: string | null;
}): Promise<void> {
  const supa = getSupabaseAdmin();
  try {
    let usuario_id: string | null = params.usuario_id ?? null;
    if (usuario_id === null) {
      const { data } = await supa
        .from('importaciones')
        .select('usuario_id')
        .eq('id', params.importacion_id)
        .maybeSingle();
      usuario_id = (data as ImportacionUsuarioRow | null)?.usuario_id ?? null;
    }

    const prioridad = params.prioridad
      ?? (params.tipo === 'IMPORTACION_FALLIDA' ? 'CRITICA'
        : params.tipo === 'IMPORTACION_COMPLETADA' ? 'INFORMATIVA'
        : 'ADVERTENCIA');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supa.from('notificaciones') as any).insert({
      tipo: params.tipo,
      prioridad,
      titulo: params.titulo,
      mensaje: params.mensaje,
      entidad_tipo: 'importacion',
      entidad_id: params.importacion_id,
      url: params.url ?? `/crm/importar/${params.importacion_id}`,
      leida: false,
      usuario_id,
    });
    // Enviar email al admin cuando la importación falla completamente
    if (params.tipo === 'IMPORTACION_FALLIDA') {
      try {
        const { encolarEmailSistema } = await import('@/lib/comunicaciones-sender');
        await encolarEmailSistema({
          tipo_evento: 'ERROR_CRITICO',
          variables_extra: {
            codigo: 'ERR_SYS_001',
            modulo: 'importador',
            endpoint: `/api/importar/${params.importacion_id}`,
            mensaje: params.mensaje.slice(0, 500),
            fecha: new Date().toLocaleString('es-AR'),
          },
        });
      } catch {
        // No bloquear si falla el email
      }
    }
  } catch (e) {
    logger.error({ modulo: 'importacion', mensaje: 'notificarImportacion fallo no crítico', contexto: { error: String(e) } });
  }
}
