// Endpoint legacy — redirige al cron unificado de limpieza de temporales.
// Se mantiene por compatibilidad con configuraciones externas que aún
// apuntan a esta URL. Nuevas integraciones deben usar /api/cron/limpiar-temporales.

import { GET as GETNuevo } from '../limpiar-temporales/route'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  logger.info({ modulo: 'cron', mensaje: 'Alias legacy limpiar-pdfs-temporales redirigido a limpiar-temporales' })
  return GETNuevo(request)
}
