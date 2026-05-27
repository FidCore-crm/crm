'use client';

import { useState, useMemo } from 'react';
import { X, Plus, AlertTriangle } from 'lucide-react';
import type { CampoDisponible } from './MapeoColumnaSelector';

interface CampoDestino {
  campo: string;
  categoria: string;
}

interface Props {
  columnaArchivo: string;
  ejemplosDatos: string[];
  camposDisponibles: CampoDisponible[];
  valorInicial?: {
    separador: string;
    campos_destino: CampoDestino[];
  };
  onAplicar: (config: {
    separador: string;
    campos_destino: CampoDestino[];
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

export function SeparadorColumnaModal({
  columnaArchivo,
  ejemplosDatos,
  camposDisponibles,
  valorInicial,
  onAplicar,
  onCancelar,
}: Props) {
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
  const [campos, setCampos] = useState<CampoDestino[]>(
    valorInicial?.campos_destino && valorInicial.campos_destino.length >= 2
      ? valorInicial.campos_destino
      : [
          { campo: '', categoria: '' },
          { campo: '', categoria: '' },
        ]
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

  const primerEjemplo = ejemplosDatos[0] || '';
  const tokens = useMemo(() => {
    if (!separadorFinal) return [primerEjemplo];
    return primerEjemplo.split(separadorFinal);
  }, [primerEjemplo, separadorFinal]);

  const addCampo = () => {
    if (campos.length >= 5) return;
    setCampos([...campos, { campo: '', categoria: '' }]);
  };

  const removeCampo = (index: number) => {
    if (campos.length <= 2) return;
    setCampos(campos.filter((_, i) => i !== index));
  };

  const updateCampo = (index: number, value: string) => {
    const c = camposDisponibles.find((x) => x.value === value);
    const nuevo = [...campos];
    nuevo[index] = {
      campo: value,
      categoria: c?.categoria || '',
    };
    setCampos(nuevo);
  };

  const camposValidos = campos.filter((c) => c.campo).length >= 2;
  const puedeAplicar = Boolean(separadorFinal) && camposValidos;

  const mismatch = tokens.length !== campos.length;

  const handleAplicar = () => {
    if (!puedeAplicar) return;
    onAplicar({
      separador: separadorFinal,
      campos_destino: campos.filter((c) => c.campo),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border shadow-lg p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Separar columna{' '}
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              «{columnaArchivo}»
            </span>{' '}
            en múltiples campos
          </h3>
          <button
            type="button"
            onClick={onCancelar}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Ejemplos */}
        {ejemplosDatos.length > 0 && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2">
            <div className="text-2xs uppercase font-semibold text-slate-500 mb-1">
              Ejemplos del archivo
            </div>
            <div className="space-y-0.5">
              {ejemplosDatos.slice(0, 5).map((e, i) => (
                <div key={i} className="font-mono text-xs text-slate-700 truncate">
                  {e || <span className="italic text-slate-400">(vacío)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Campos destino */}
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Campos destino
          </label>
          <div className="space-y-1.5">
            {campos.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-2xs text-slate-500 w-16 shrink-0">
                  Campo {i + 1}
                </span>
                <select
                  value={c.campo}
                  onChange={(e) => updateCampo(i, e.target.value)}
                  className="form-input text-xs flex-1"
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
                {campos.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeCampo(i)}
                    className="text-red-500 hover:text-red-700 text-sm px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {campos.length < 5 && (
            <button
              type="button"
              onClick={addCampo}
              className="mt-2 text-2xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Agregar campo destino
            </button>
          )}
        </div>

        {/* Preview */}
        <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2">
          <div className="text-2xs uppercase font-semibold text-slate-500 mb-1">
            Preview
          </div>
          {campos.map((c, i) => {
            const token = tokens[i];
            const hasToken = Boolean(token);
            const campoLabel =
              camposDisponibles.find((x) => x.value === c.campo)?.label ||
              `Campo ${i + 1}`;
            return (
              <div
                key={i}
                className={`text-xs font-mono ${
                  hasToken ? 'text-green-700' : 'text-red-500'
                }`}
              >
                {campoLabel}:{' '}
                {hasToken ? token : <span className="italic">(vacío)</span>}
              </div>
            );
          })}
          {mismatch && (
            <div className="mt-2 text-2xs text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              El separador produce {tokens.length} tokens pero tenés{' '}
              {campos.length} campos destino.
            </div>
          )}
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
