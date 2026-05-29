'use client'

/**
 * Banner accionable en `/crm/comunicaciones` cuando hay:
 *   - Emails ENCOLADOS hace >12h (SMTP caído o cron muerto)
 *   - O FALLIDOS del mes que podrían reintentarse
 *
 * Permite reintentar todos los FALLIDOS de un saque, con confirmación.
 */

import { useState } from 'react'
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

interface Props {
  colaAtrasada: number
  fallidosMes: number
  fallidosReintentables: number
  onReintentar: () => void
}

export default function BannerColaAtrasada({
  colaAtrasada, fallidosMes, fallidosReintentables, onReintentar,
}: Props) {
  const [reintentando, setReintentando] = useState(false)

  const fallidosDefinitivos = fallidosMes - fallidosReintentables

  // Si NO hay cola atrasada y los fallidos ya se están reintentando solos,
  // mostramos un banner informativo ligero (azul) — no acción urgente.
  // Si HAY cola atrasada o fallidos definitivos, banner rojo accionable.
  const esCritico = colaAtrasada > 0 || fallidosDefinitivos > 0

  async function reintentarTodos() {
    const total = fallidosMes
    const msg = `¿Reintentar los ${total} emails FALLIDOS de este mes?\n\n` +
      `Se va a crear un nuevo intento para cada uno. ` +
      `Los que ya intentaron 4 veces o tienen errores definitivos (email inválido) ` +
      `se reintentarán igual — vos decidís si vale la pena.`
    if (!confirm(msg)) return

    setReintentando(true)
    const r = await apiCall<{ encolados: number; omitidos: number; total_fallidos: number }>(
      '/api/comunicaciones/historial/reintentar-masivo',
      { method: 'POST', body: {} },
      { mostrar_toast_en_error: false },
    )
    setReintentando(false)

    if (r.ok && r.data) {
      toast.exito(`${r.data.encolados} emails reencolados${r.data.omitidos > 0 ? ` (${r.data.omitidos} fallaron al reencolar)` : ''}`)
      onReintentar()
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudieron reintentar los emails')
    }
  }

  return (
    <div className={`flex items-start gap-3 p-3 rounded border ${
      esCritico
        ? 'bg-red-50 border-red-300 text-red-900'
        : 'bg-blue-50 border-blue-200 text-blue-900'
    }`}>
      <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${esCritico ? 'text-red-600' : 'text-blue-600'}`} />
      <div className="flex-1 text-xs leading-relaxed">
        {colaAtrasada > 0 && (
          <p className="font-semibold mb-1">
            ⚠ {colaAtrasada} {colaAtrasada === 1 ? 'email está' : 'emails están'} encolados hace más de 12 horas.
          </p>
        )}
        {colaAtrasada > 0 && (
          <p className="mb-1">
            Suele indicar SMTP caído, cron detenido o un problema de configuración. Revisá{' '}
            <strong>Configuración → Correos</strong> y probá la conexión.
          </p>
        )}
        {fallidosReintentables > 0 && (
          <p className="mb-1">
            {fallidosReintentables} {fallidosReintentables === 1 ? 'email fallido se reintentará' : 'emails fallidos se reintentarán'} automáticamente en las próximas horas (backoff: 30 min → 2h → 8h → 24h).
          </p>
        )}
        {fallidosDefinitivos > 0 && (
          <p>
            {fallidosDefinitivos} {fallidosDefinitivos === 1 ? 'email tuvo' : 'emails tuvieron'} un error definitivo (email inválido, dominio caído o ya intentamos 4 veces). Podés intentarlos manualmente si querés.
          </p>
        )}
      </div>
      {fallidosMes > 0 && (
        <button
          onClick={reintentarTodos}
          disabled={reintentando}
          className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded transition-colors ${
            esCritico
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-white border border-blue-300 hover:bg-blue-50 text-blue-700'
          } disabled:opacity-60`}
        >
          {reintentando
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          Reintentar todos
        </button>
      )}
    </div>
  )
}
