'use client';

import { useState, useMemo } from 'react';
import { X, Search, Sparkles, Scissors, Link2, Ban } from 'lucide-react';

export type MapeoColumna =
  | { tipo: 'DIRECTO'; campo: string; categoria: 'PERSONA' | 'POLIZA' | 'RIESGO' }
  | { tipo: 'IGNORAR' }
  | {
      tipo: 'SEPARAR';
      separador: string;
      campos_destino: Array<{ campo: string; categoria: string }>;
    }
  | {
      tipo: 'COMBINAR';
      columnas_origen: string[];
      separador: string;
      campo_destino: string;
      categoria: string;
    };

export interface CampoDisponible {
  value: string;
  label: string;
  categoria: 'PERSONA' | 'POLIZA' | 'RIESGO';
  descripcion?: string;
}

interface Props {
  columnaArchivo: string;
  valorActual: MapeoColumna | null;
  camposDisponibles: CampoDisponible[];
  ejemplosDatos: string[];
  sugerenciaIA?: { campo: string; confianza: number };
  onChange: (nuevoMapeo: MapeoColumna) => void;
  onClose?: () => void;
  onOpenSeparador?: () => void;
  onOpenCombinar?: () => void;
}

type Tab = 'PERSONA' | 'POLIZA' | 'RIESGO' | 'ESPECIAL';

const TAB_LABELS: Record<Tab, string> = {
  PERSONA: 'Persona',
  POLIZA: 'Póliza',
  RIESGO: 'Riesgo',
  ESPECIAL: 'Acciones especiales',
};

export function MapeoColumnaSelector({
  columnaArchivo,
  valorActual,
  camposDisponibles,
  ejemplosDatos,
  sugerenciaIA,
  onChange,
  onClose,
  onOpenSeparador,
  onOpenCombinar,
}: Props) {
  const [tab, setTab] = useState<Tab>('PERSONA');
  const [query, setQuery] = useState('');

  const camposFiltrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return camposDisponibles.filter((c) => {
      if (tab !== 'ESPECIAL' && c.categoria !== tab) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q)
      );
    });
  }, [camposDisponibles, tab, query]);

  const seleccionarDirecto = (c: CampoDisponible) => {
    onChange({ tipo: 'DIRECTO', campo: c.value, categoria: c.categoria });
    onClose?.();
  };

  const campoSugerido = useMemo(
    () =>
      sugerenciaIA
        ? camposDisponibles.find((c) => c.value === sugerenciaIA.campo)
        : null,
    [sugerenciaIA, camposDisponibles]
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border shadow-lg p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Mapear columna{' '}
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                «{columnaArchivo}»
              </span>
            </h3>
            <p className="text-2xs text-slate-600 mt-0.5">
              Elegí a qué campo del CRM corresponde esta columna del archivo.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Ejemplos */}
        {ejemplosDatos.length > 0 && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2">
            <div className="text-2xs uppercase font-semibold text-slate-600 mb-1">
              Ejemplos del archivo
            </div>
            <div className="space-y-0.5">
              {ejemplosDatos.slice(0, 3).map((e, i) => (
                <div key={i} className="font-mono text-xs text-slate-700 truncate">
                  {e || <span className="italic text-slate-500">(vacío)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sugerencia IA */}
        {sugerenciaIA && sugerenciaIA.confianza >= 0.7 && campoSugerido && (
          <div className="mb-3 bg-green-50 border border-green-200 rounded p-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-green-800">
              <Sparkles className="w-4 h-4" />
              <span>
                IA sugiere: <strong>{campoSugerido.label}</strong> (
                {Math.round(sugerenciaIA.confianza * 100)}%)
              </span>
            </div>
            <button
              type="button"
              onClick={() => seleccionarDirecto(campoSugerido)}
              className="btn-primary text-2xs px-2 py-1"
            >
              Usar sugerencia
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-3">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Contenido */}
        {tab !== 'ESPECIAL' ? (
          <>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar campo..."
                className="form-input pl-7 text-xs w-full"
              />
            </div>

            {camposFiltrados.length === 0 ? (
              <div className="text-xs text-slate-600 italic py-4 text-center">
                No hay campos que coincidan.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
                {camposFiltrados.map((c) => {
                  const activo =
                    valorActual?.tipo === 'DIRECTO' &&
                    valorActual.campo === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => seleccionarDirecto(c)}
                      className={`text-left border rounded px-2 py-1.5 text-xs transition-colors ${
                        activo
                          ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-semibold truncate">{c.label}</div>
                      {c.descripcion && (
                        <div className="text-2xs text-slate-600 truncate">
                          {c.descripcion}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onOpenSeparador?.()}
              className="w-full border border-slate-200 rounded p-3 hover:bg-slate-50 flex items-start gap-3 text-left"
            >
              <Scissors className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold">
                  Separar en varios campos
                </div>
                <div className="text-2xs text-slate-600">
                  Cuando la columna contiene varios datos juntos (ej: &quot;Nombre
                  Apellido&quot;).
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onOpenCombinar?.()}
              className="w-full border border-slate-200 rounded p-3 hover:bg-slate-50 flex items-start gap-3 text-left"
            >
              <Link2 className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold">
                  Combinar con otras columnas
                </div>
                <div className="text-2xs text-slate-600">
                  Juntar varias columnas del archivo en un solo campo del CRM.
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ tipo: 'IGNORAR' });
                onClose?.();
              }}
              className="w-full border border-slate-200 rounded p-3 hover:bg-red-50 hover:border-red-200 flex items-start gap-3 text-left"
            >
              <Ban className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-red-700">
                  Ignorar esta columna
                </div>
                <div className="text-2xs text-slate-600">
                  No importar los datos de esta columna.
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2 pt-3 border-t border-slate-200">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
