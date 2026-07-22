'use client'

import { X, Loader2 } from 'lucide-react'

interface Props {
  abierto: boolean
  onCerrar: () => void
  html: string
  titulo?: string
  cargando?: boolean
}

/**
 * Modal grande, dedicado a mostrar la vista previa de un email renderizado.
 *
 * Se abre ENCIMA del modal que lo invoca (típicamente ModalEnviarEmail,
 * ModalEnviarEmailMasivo, WizardNuevoEnvio). Al cerrarse vuelve al modal
 * padre sin perder estado.
 *
 * Motivación: hasta v1.0.171 la vista previa se renderizaba INLINE al final
 * del body del modal padre, lo cual la ponía en el borde inferior sin poder
 * scrollearse cómodamente aunque el body tuviera `min-h-0 overflow-auto`
 * (el iframe con `minHeight: 400px` empujaba el layout de forma inestable).
 *
 * Al ser modal dedicado, el iframe ocupa casi toda la ventana y siempre se
 * ve completo. Ver [[patron-vista-previa-modal-aparte]].
 *
 * Nota UX: NO cierra al click en el backdrop (evita cierre accidental si
 * el PAS está mirando la preview). Solo cierra por botón X, botón Cerrar
 * del footer, o tecla Escape.
 */
export default function ModalVistaPrevia({ abierto, onCerrar, html, titulo = 'Vista previa del email', cargando = false }: Props) {
  if (!abierto) return null

  return (
    // z-[60] para quedar POR ENCIMA del modal padre (que usa z-50). El
    // stopPropagation en el overlay evita que clicks dentro del preview
    // burbujeen al backdrop del modal padre y lo cierren en cascada
    // (mismo patrón que SelectorImagenBiblioteca — ver v1.0.171).
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-4xl flex flex-col"
        style={{ height: '90vh', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
          <button
            onClick={onCerrar}
            className="text-slate-500 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
            aria-label="Cerrar vista previa"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — el iframe ocupa todo el espacio disponible */}
        <div className="flex-1 min-h-0 overflow-hidden bg-slate-100">
          {cargando ? (
            <div className="h-full flex items-center justify-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Generando vista previa...
            </div>
          ) : (
            <iframe
              srcDoc={html}
              title="Vista previa"
              className="w-full h-full border-0 bg-white"
              sandbox="allow-same-origin allow-popups"
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onCerrar} className="btn-secondary text-xs px-4 py-1.5">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
