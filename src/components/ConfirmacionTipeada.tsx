'use client'

/**
 * Modal de confirmación que requiere tipear una palabra específica antes
 * de habilitar el botón de "Confirmar". Pensado para acciones destructivas
 * irreversibles (eliminar usuarios, eliminar licencias, etc.).
 *
 * Reemplaza al `confirm()` nativo para acciones de alto impacto, siguiendo
 * el patrón ya usado en backups/restaurar (escribir "RESTAURAR").
 *
 * Uso:
 *
 *   const [abierto, setAbierto] = useState(false)
 *
 *   <ConfirmacionTipeada
 *     abierto={abierto}
 *     titulo="Eliminar usuario"
 *     mensaje="Esta acción borra a Juan Pérez del sistema y no se puede deshacer."
 *     palabraConfirmar="ELIMINAR"
 *     etiquetaConfirmar="Eliminar usuario"
 *     onConfirmar={async () => { await api(...); setAbierto(false) }}
 *     onCancelar={() => setAbierto(false)}
 *   />
 */

import { useEffect, useState } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'

interface Props {
  abierto: boolean
  titulo: string
  mensaje: string
  palabraConfirmar: string
  etiquetaConfirmar?: string
  destructivo?: boolean
  onConfirmar: () => void | Promise<void>
  onCancelar: () => void
}

export function ConfirmacionTipeada({
  abierto,
  titulo,
  mensaje,
  palabraConfirmar,
  etiquetaConfirmar = 'Confirmar',
  destructivo = true,
  onConfirmar,
  onCancelar,
}: Props) {
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!abierto) {
      setTexto('')
      setCargando(false)
    }
  }, [abierto])

  // Cerrar con Escape (patrón estándar de modales).
  useEffect(() => {
    if (!abierto) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cargando) onCancelar()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [abierto, cargando, onCancelar])

  if (!abierto) return null

  const matchea = texto.trim() === palabraConfirmar
  const colorBtn = destructivo
    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
    : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300'

  const submit = async () => {
    if (!matchea) return
    setCargando(true)
    try {
      await onConfirmar()
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {destructivo && <AlertTriangle className="h-4 w-4 text-red-600" />}
            <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            disabled={cargando}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">{mensaje}</p>

          <div>
            <label className="block text-xs text-slate-600 mb-1">
              Escribí <span className="font-mono font-bold text-red-600">{palabraConfirmar}</span> para confirmar
            </label>
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matchea && !cargando) {
                  e.preventDefault()
                  void submit()
                }
              }}
              autoFocus
              disabled={cargando}
              autoComplete="off"
              spellCheck={false}
              placeholder={palabraConfirmar}
              className="form-input w-full font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancelar}
            disabled={cargando}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!matchea || cargando}
            className={`px-3.5 h-8 text-sm font-medium text-white rounded transition-colors flex items-center gap-1.5 ${colorBtn}`}
          >
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {etiquetaConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
