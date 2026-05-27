'use client';

import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import type { CampoDisponible } from './MapeoColumnaSelector';

interface Props {
  todasLasColumnas: Array<{ nombre: string; ejemplos: string[] }>;
  columnaInicial: string;
  camposDisponibles: CampoDisponible[];
  valorInicial?: {
    columnas_origen: string[];
    separador: string;
    campo_destino: string;
    categoria: string;
  };
  onAplicar: (config: {
    columnas_origen: string[];
    separador: string;
    campo_destino: string;
    categoria: string;
  }) => void;
  onCancelar: () => void;
}

const SEPARADORES_PRESET: Array<{ label: string; value: string }> = [
  { label: 'Espacio', value: ' ' },
  { label: 'Coma + espacio', value: ', ' },
  { label: 'Coma', value: ',' },
  { label: 'Guión', value: '-' },
];

const CUSTOM = '__CUSTOM__';

export function CombinarColumnaModal({
  todasLasColumnas,
  columnaInicial,
  camposDisponibles,
  valorInicial,
  onAplicar,
  onCancelar,
}: Props) {
  const initialSelected = new Set<string>(
    valorInicial?.columnas_origen ?? [columnaInicial]
  );
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(
    initialSelected
  );

  const initialSeparadorPreset = useMemo(() => {
    if (!valorInicial) return ' ';
    const preset = SEPARADORES_PRESET.find(
      (p) => p.value === valorInicial.separador
    );
    return preset ? preset.value : CUSTOM;
  }, [valorInicial]);

  const [separadorSel, setSeparadorSel] = useState<string>(
    initialSeparadorPreset
  );
  const [separadorCustom, setSeparadorCustom] = useState<string>(
    valorInicial && initialSeparadorPreset === CUSTOM
      ? valorInicial.separador
      : ''
  );
  const [campoDestino, setCampoDestino] = useState<string>(
    valorInicial?.campo_destino ?? ''
  );

  const separadorFinal =
    separadorSel === CUSTOM ? separadorCustom : separadorSel;

  const camposPorCategoria = useMemo(() => {
    const groups: Record<string, CampoDisponible[]> = {};
    for (const c of camposDisponibles) {
      if (!groups[c.categoria]) groups[c.categoria] = [];
      groups[c.categoria].push(c);
    }
    return groups;
  }, [camposDisponibles]);

  const toggleColumna = (nombre: string) => {
    const nueva = new Set(seleccionadas);
    if (nueva.has(nombre)) nueva.delete(nombre);
    else nueva.add(nombre);
    setSeleccionadas(nueva);
  };

  // Preview: tomar primer ejemplo de cada columna seleccionada, en el orden de todasLasColumnas
  const preview = useMemo(() => {
    const partes: string[] = [];
    for (const col of todasLasColumnas) {
      if (seleccionadas.has(col.nombre)) {
        partes.push(col.ejemplos[0] ?? '');
      }
    }
    return partes.join(separadorFinal);
  }, [todasLasColumnas, seleccionadas, separadorFinal]);

  const columnasOrigenOrdenadas = useMemo(
    () =>
      todasLasColumnas
        .filter((c) => seleccionadas.has(c.nombre))
        .map((c) => c.nombre),
    [todasLasColumnas, seleccionadas]
  );

  const campoSeleccionadoObj = useMemo(
    () => camposDisponibles.find((c) => c.value === campoDestino),
    [camposDisponibles, campoDestino]
  );

  const puedeAplicar =
    seleccionadas.size >= 2 &&
    Boolean(separadorFinal) &&
    Boolean(campoDestino) &&
    Boolean(campoSeleccionadoObj);

  const handleAplicar = () => {
    if (!puedeAplicar || !campoSeleccionadoObj) return;
    onAplicar({
      columnas_origen: columnasOrigenOrdenadas,
      separador: separadorFinal,
      campo_destino: campoDestino,
      categoria: campoSeleccionadoObj.categoria,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border shadow-lg p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Combinar columnas en un solo campo del CRM
          </h3>
          <button
            type="button"
            onClick={onCancelar}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Columnas */}
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Columnas a combinar ({seleccionadas.size} seleccionadas)
          </label>
          <div className="border border-slate-200 rounded max-h-56 overflow-y-auto">
            {todasLasColumnas.map((col) => {
              const marcada = seleccionadas.has(col.nombre);
              return (
                <label
                  key={col.nombre}
                  className={`flex items-start gap-2 px-2 py-1.5 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 ${
                    marcada ? 'bg-blue-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={() => toggleColumna(col.nombre)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      {col.nombre}
                    </div>
                    <div className="text-2xs text-slate-500 font-mono truncate">
                      {col.ejemplos.slice(0, 2).join(' | ') || '(vacío)'}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Separador */}
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Separador
          </label>
          <select
            value={separadorSel}
            onChange={(e) => setSeparadorSel(e.target.value)}
            className="form-input text-xs w-full"
          >
            {SEPARADORES_PRESET.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value={CUSTOM}>Personalizado</option>
          </select>
          {separadorSel === CUSTOM && (
            <input
              type="text"
              value={separadorCustom}
              onChange={(e) => setSeparadorCustom(e.target.value)}
              placeholder="Ingresá el separador..."
              className="form-input text-xs w-full mt-2"
            />
          )}
        </div>

        {/* Campo destino */}
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Campo destino del CRM
          </label>
          <select
            value={campoDestino}
            onChange={(e) => setCampoDestino(e.target.value)}
            className="form-input text-xs w-full"
          >
            <option value="">— Seleccionar —</option>
            {Object.entries(camposPorCategoria).map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Preview */}
        <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2">
          <div className="text-2xs uppercase font-semibold text-slate-500 mb-1">
            Preview
          </div>
          <div className="font-mono text-xs text-green-700 break-all">
            {preview || <span className="italic text-slate-400">(vacío)</span>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancelar}
            className="btn-secondary text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAplicar}
            disabled={!puedeAplicar}
            className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
