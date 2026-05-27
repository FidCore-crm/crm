/**
 * Wrapper sobre `sonner` para mostrar toasts de forma consistente en el CRM.
 *
 * El <Toaster /> de sonner está montado en `src/app/crm/layout.tsx`.
 *
 * Uso:
 *   import { toast } from '@/lib/toast'
 *   toast.exito('Póliza creada')
 *   toast.error({ codigo: 'ERR_DB_001', mensaje: 'No se pudo guardar' })
 *   toast.error('Algo falló')         // también acepta string
 *   toast.info('Recargando...')
 *   toast.warning('Revisá antes de confirmar')
 *   toast.promise(fetchAlgo(), { loading: '...', success: 'OK', error: 'Falló' })
 */

import { toast as sonnerToast } from 'sonner'

export interface ToastError {
  codigo?: string
  mensaje: string
  /** Mensaje sin tecnicismos para el usuario. Si está, se muestra en lugar de `mensaje`. */
  mensaje_humano?: string
  /** Qué puede hacer el usuario. Se muestra como description si está. */
  sugerencia?: string
}

type ErrorInput = string | ToastError

function normalizarError(error: ErrorInput): ToastError {
  if (typeof error === 'string') return { mensaje: error }
  return error
}

export const toast = {
  exito(mensaje: string): void {
    sonnerToast.success(mensaje)
  },

  /**
   * Toast con acción de deshacer. Por defecto dura 12 s para que el usuario
   * tenga tiempo de reaccionar. Se usa después de operaciones reversibles
   * como soft-delete.
   */
  exitoConDeshacer(
    mensaje: string,
    accion: { label: string; onClick: () => void; duracionMs?: number },
  ): void {
    sonnerToast.success(mensaje, {
      action: {
        label: accion.label,
        onClick: accion.onClick,
      },
      duration: accion.duracionMs ?? 12000,
    })
  },

  error(error: ErrorInput): void {
    const e = normalizarError(error)
    // Preferimos el mensaje humano si vino, fallback al técnico
    const titulo = e.mensaje_humano || e.mensaje
    // Description: la sugerencia es lo más útil. Si no hay, mostramos el código.
    // Si hay sugerencia y código, los combinamos.
    let description: string | undefined
    if (e.sugerencia && e.codigo) {
      description = `${e.sugerencia} (${e.codigo})`
    } else if (e.sugerencia) {
      description = e.sugerencia
    } else if (e.codigo) {
      description = `Código: ${e.codigo}`
    }
    // Los errores con código o sugerencia duran más para que el usuario alcance a leer
    const duracion = e.codigo || e.sugerencia ? 7000 : 5000
    sonnerToast.error(titulo, {
      description,
      duration: duracion,
    })
  },

  info(mensaje: string): void {
    sonnerToast.info(mensaje)
  },

  warning(mensaje: string): void {
    sonnerToast.warning(mensaje)
  },

  promise<T>(
    promesa: Promise<T>,
    mensajes: { loading: string; success: string | ((data: T) => string); error: string | ((err: unknown) => string) }
  ): ReturnType<typeof sonnerToast.promise> {
    return sonnerToast.promise(promesa, mensajes)
  },
}
