'use client'

import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react'

type Tipo = 'COMPANIA' | 'RAMO' | 'COBERTURA'

interface Opcion {
  id: string
  nombre: string
}

interface Props {
  tipo: Tipo
  valor_pdf: string | null
  valor_mapeado_id: string | null
  opciones: Opcion[]
  onMapear: (id: string | null) => void
  onCrearNuevo?: () => void
  permiteCrear?: boolean
  nombreMapeado?: string
  pendienteCrearNombre?: string | null
  onCancelarPendiente?: () => void
}

const LABELS: Record<Tipo, string> = {
  COMPANIA: 'Compañía',
  RAMO: 'Ramo',
  COBERTURA: 'Cobertura',
}

export default function SelectorCatalogoPDF({
  tipo,
  valor_pdf,
  valor_mapeado_id,
  opciones,
  onMapear,
  onCrearNuevo,
  permiteCrear = true,
  nombreMapeado,
  pendienteCrearNombre,
  onCancelarPendiente,
}: Props) {
  const resuelto = !!valor_mapeado_id || !!pendienteCrearNombre
  const Icono = resuelto ? CheckCircle2 : AlertTriangle

  return (
    <div className="border border-slate-200 rounded p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-slate-500 uppercase tracking-wide font-semibold">
          {LABELS[tipo]}
        </span>
        <Icono className={`h-3.5 w-3.5 ${resuelto ? 'text-emerald-500' : 'text-amber-500'}`} />
      </div>

      {resuelto ? (
        <div className="flex flex-col gap-1">
          {pendienteCrearNombre ? (
            <>
              <p className="text-xs text-blue-700 font-medium">
                Se va a crear: &ldquo;{pendienteCrearNombre}&rdquo;
              </p>
              <p className="text-2xs text-slate-400">Al aprobar, el catálogo se agrega automáticamente.</p>
              <button
                onClick={() => onCancelarPendiente?.()}
                className="text-2xs text-blue-600 hover:underline text-left"
              >
                Cancelar — mapear a existente
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-700 font-medium">{nombreMapeado || '—'}</p>
              {valor_pdf && (
                <p className="text-2xs text-slate-400">
                  Desde el PDF: &ldquo;{valor_pdf}&rdquo;
                </p>
              )}
              <button
                onClick={() => onMapear(null)}
                className="text-2xs text-blue-600 hover:underline text-left"
              >
                Cambiar mapeo
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {valor_pdf && (
            <p className="text-2xs text-amber-700 leading-tight">
              &ldquo;{valor_pdf}&rdquo; del PDF no se pudo mapear automáticamente.
            </p>
          )}
          <select
            className="form-input w-full text-xs"
            value={valor_mapeado_id || ''}
            onChange={e => onMapear(e.target.value || null)}
          >
            <option value="">— Mapear a existente —</option>
            {opciones.map(o => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
          {permiteCrear && onCrearNuevo && valor_pdf && (
            <button
              onClick={onCrearNuevo}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 text-left"
            >
              <Plus className="h-3 w-3" /> Crear &ldquo;{valor_pdf}&rdquo; como {LABELS[tipo].toLowerCase()} nueva
            </button>
          )}
        </div>
      )}
    </div>
  )
}
