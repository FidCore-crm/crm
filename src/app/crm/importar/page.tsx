'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  FileSpreadsheet,
  FileText,
  Upload,
  X,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Download,
  Info,
} from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  urlContinuarImportacion,
  labelContinuarImportacion,
  ESTADOS_REQUIEREN_ATENCION,
  ESTADOS_EN_PROGRESO,
} from '@/lib/importacion/navegacion';

const MAX_ARCHIVOS = 10;
const MAX_BYTES_POR_ARCHIVO = 50 * 1024 * 1024;
const MAX_BYTES_TOTAL = 200 * 1024 * 1024;
const EXT_VALIDAS = new Set(['xlsx', 'xls', 'csv', 'pdf']);

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconoArchivo(nombre: string) {
  const ext = nombre.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xls') {
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  }
  if (ext === 'pdf') {
    return <FileText className="w-5 h-5 text-red-600" />;
  }
  return <FileText className="w-5 h-5 text-slate-500" />;
}

export default function ImportarPage() {
  const router = useRouter();
  const { usuario, isAdmin, loading: authLoading } = useAuth();
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configurada, setConfigurada] = useState<boolean | null>(null);

  // Importador es admin-only: el USUARIO común no puede importar cartera masiva.
  useEffect(() => {
    if (!authLoading && usuario && !isAdmin) {
      router.replace('/crm/dashboard');
    }
  }, [authLoading, usuario, isAdmin, router]);

  const [archivos, setArchivos] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [opcionesAbiertas, setOpcionesAbiertas] = useState(false);
  const [notas, setNotas] = useState('');
  const [incremental, setIncremental] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  interface ImportacionActiva {
    id: string;
    estado_proceso: string;
    tipo: string | null;
    nombre_archivo: string | null;
    created_at: string;
  }
  const [importacionesActivas, setImportacionesActivas] = useState<ImportacionActiva[]>([]);
  const [modalInstruccionesAbierto, setModalInstruccionesAbierto] = useState(false);

  const inputFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      const r = await apiCall<{ configurada: boolean }>('/api/importar/config-check', { cache: 'no-store' }, { mostrar_toast_en_error: false });
      if (!activo) return;
      setConfigurada(r.ok ? Boolean(r.data?.configurada) : false);
      setLoadingConfig(false);
    })();
    return () => {
      activo = false;
    };
  }, []);

  // Detectar importaciones del usuario que quedaron pendientes de atención
  // (REVISANDO, ANALIZADO, PAUSADA) o en progreso (PENDIENTE, ANALIZANDO,
  // IMPORTANDO). Mostramos banner con link directo al paso que corresponde.
  useEffect(() => {
    if (!configurada) return;
    let activo = true;
    (async () => {
      const r = await apiCall<{ data: ImportacionActiva[]; total: number }>(
        '/api/importar/historial?pagina=1&por_pagina=10&estado=EN_PROCESO',
        { cache: 'no-store' },
        { mostrar_toast_en_error: false },
      );
      if (!activo) return;
      if (r.ok && Array.isArray(r.data?.data)) {
        setImportacionesActivas(r.data.data);
      }
    })();
    return () => {
      activo = false;
    };
  }, [configurada]);

  const impRequierenAtencion = importacionesActivas.filter((i) =>
    ESTADOS_REQUIEREN_ATENCION.has(i.estado_proceso),
  );
  const impEnProgreso = importacionesActivas.filter((i) =>
    ESTADOS_EN_PROGRESO.has(i.estado_proceso),
  );

  function validarYAgregar(nuevos: File[]) {
    const combinados = [...archivos];
    let rechazados = 0;
    let motivoRechazo = '';
    for (const f of nuevos) {
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      if (!EXT_VALIDAS.has(ext)) {
        rechazados++;
        motivoRechazo = `"${f.name}": extensión no permitida`;
        continue;
      }
      if (f.size > MAX_BYTES_POR_ARCHIVO) {
        rechazados++;
        motivoRechazo = `"${f.name}" supera 50 MB`;
        continue;
      }
      if (combinados.length >= MAX_ARCHIVOS) {
        rechazados++;
        motivoRechazo = `Máximo ${MAX_ARCHIVOS} archivos`;
        continue;
      }
      combinados.push(f);
    }
    const totalBytes = combinados.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_BYTES_TOTAL) {
      toast.error('El total supera los 200 MB. Quitá algún archivo.');
      return;
    }
    setArchivos(combinados);
    if (rechazados > 0) {
      toast.error(motivoRechazo || `${rechazados} archivo(s) rechazado(s)`);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) validarYAgregar(files);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) validarYAgregar(files);
    if (inputFileRef.current) inputFileRef.current.value = '';
  }

  function quitarArchivo(idx: number) {
    setArchivos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function iniciarAnalisis() {
    if (archivos.length === 0) return;
    setSubiendo(true);
    const fd = new FormData();
    archivos.forEach((f) => fd.append('archivos', f));
    fd.append('tipo', incremental ? 'INCREMENTAL' : 'INICIAL');
    if (notas.trim()) fd.append('notas', notas.trim());
    const r = await apiCall<{ importacion_id: string }>('/api/importar/iniciar', {
      method: 'POST',
      body: fd,
    });
    if (r.ok && r.data?.importacion_id) {
      router.push(`/crm/importar/${r.data.importacion_id}/procesando`);
    } else {
      setSubiendo(false);
    }
  }

  if (authLoading || (usuario && !isAdmin) || loadingConfig) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (configurada === false) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-100 mb-4">
            <Sparkles className="w-8 h-8 text-violet-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Importación inteligente con IA
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            Para usar el importador necesitás configurar una API key de Anthropic.
          </p>
          <ul className="text-left space-y-2 mb-8 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span className="text-violet-600 font-bold">•</span>
              Procesa cualquier formato (Excel, CSV, PDF) sin configuración previa
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-600 font-bold">•</span>
              Detecta automáticamente clientes, pólizas y riesgos
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-600 font-bold">•</span>
              Vincula clientes con sus pólizas por DNI u otros campos
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-600 font-bold">•</span>
              Importa hasta 4000 registros sin revisar uno por uno
            </li>
          </ul>
          <button
            className="btn-primary w-full"
            onClick={() => router.push('/crm/configuracion/agente-ia')}
          >
            Configurar API key
          </button>
          <p className="text-2xs text-slate-500 mt-4">
            ¿No sabés qué es Anthropic? Es la empresa creadora de Claude. Necesitás una
            cuenta en console.anthropic.com
          </p>
        </div>
      </div>
    );
  }

  const totalBytes = archivos.reduce((s, f) => s + f.size, 0);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {subiendo && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-8 flex flex-col items-center gap-4 shadow-xl">
            <Loader2 className="w-10 h-10 text-violet-600 animate-spin" />
            <p className="text-sm text-slate-700 font-medium">
              Subiendo archivos e iniciando análisis...
            </p>
            <p className="text-2xs text-slate-500">Esto puede tardar unos segundos</p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Importar cartera</h1>
          <p className="text-sm text-slate-600 mt-1">
            Subí los archivos de tu cartera y el sistema los procesa con IA
          </p>
        </div>
        <button
          className="btn-secondary flex items-center gap-2"
          onClick={() => router.push('/crm/importar/historial')}
        >
          <History className="w-4 h-4" />
          Ver historial
        </button>
      </div>

      {/* Banners de importaciones pendientes de atención o en progreso */}
      {impRequierenAtencion.map((imp) => {
        const url = urlContinuarImportacion({ id: imp.id, estado: imp.estado_proceso, tipo: imp.tipo });
        const label = labelContinuarImportacion(imp.estado_proceso);
        return (
          <div
            key={imp.id}
            className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-center gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Importación pendiente de atención
              </p>
              <p className="text-xs text-amber-800 truncate">
                {imp.nombre_archivo ?? 'Sin nombre'} · estado{' '}
                <span className="font-mono font-semibold">{imp.estado_proceso}</span>
              </p>
            </div>
            {url && (
              <button
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => router.push(url)}
              >
                {label}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {impEnProgreso.map((imp) => {
        const url = urlContinuarImportacion({ id: imp.id, estado: imp.estado_proceso, tipo: imp.tipo });
        const label = labelContinuarImportacion(imp.estado_proceso);
        return (
          <div
            key={imp.id}
            className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3"
          >
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">Importación en progreso</p>
              <p className="text-xs text-blue-800 truncate">
                {imp.nombre_archivo ?? 'Sin nombre'} · estado{' '}
                <span className="font-mono font-semibold">{imp.estado_proceso}</span>
              </p>
            </div>
            {url && (
              <button
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => router.push(url)}
              >
                {label}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}

      <div
        className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragActive
            ? 'border-violet-500 bg-violet-50'
            : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={onDrop}
        onClick={() => inputFileRef.current?.click()}
        role="button"
      >
        <input
          ref={inputFileRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.pdf"
          hidden
          onChange={onInputChange}
        />
        <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <p className="text-base font-medium text-slate-700">
          Arrastrá tus archivos acá o hacé clic para seleccionar
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Formatos: XLSX, XLS, CSV, PDF · Máx. 10 archivos · 50 MB c/u
        </p>
      </div>

      {/* Consejos previos */}
      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-blue-700 flex-shrink-0 mt-0.5" />
          <h3 className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
            Consejos para una mejor importación
          </h3>
        </div>

        <div className="ml-6 mb-3 p-3 bg-white border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-900 mb-2">
            <strong>La forma más simple de importar sin errores</strong> es usar nuestro
            modelo oficial. Ya tiene las columnas y los valores esperados por el CRM —
            completalo con tu cartera, borrá las filas de ejemplo y subilo acá.
          </p>
          <p className="text-xs text-blue-900 mb-3">
            Evita que te queden campos en blanco (compañía, ramo, cobertura,
            refacturación, vigencia) o datos duplicados en columnas distintas.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/importar/modelo-excel"
              download="modelo-importacion-crm-seguros.xlsx"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar modelo Excel
            </a>
            <button
              type="button"
              onClick={() => setModalInstruccionesAbierto(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-blue-50 border border-blue-300 text-blue-700 text-xs font-medium rounded-lg transition-colors"
            >
              <Info className="w-3.5 h-3.5" />
              Ver instrucciones
            </button>
          </div>
        </div>

        <p className="text-2xs text-blue-900 ml-6 mb-1 uppercase tracking-wide font-semibold">
          Si preferís importar tu propio archivo
        </p>
        <ul className="text-xs text-blue-900 space-y-1.5 ml-6 list-disc">
          <li>
            <strong>Separá apellido y nombre en columnas distintas</strong> antes de
            subir el archivo. El asistente no siempre logra dividirlos correctamente
            cuando vienen juntos en una sola celda (ej: &quot;PEREZ JUAN CARLOS&quot;).
          </li>
          <li>
            Asegurate de que el DNI/CUIL esté en una columna propia y sin puntos ni
            guiones innecesarios.
          </li>
          <li>
            Si tenés múltiples archivos (clientes + pólizas), subilos juntos — el
            asistente los vincula por DNI.
          </li>
          <li>
            Antes de importar configurá los <strong>catálogos</strong> (compañías,
            ramos, coberturas, refacturación, vigencia). Si el archivo trae un valor
            que no existe en tus catálogos, el sistema va a frenar la importación y te
            va a avisar para que lo crees.
          </li>
          <li>
            Revisá siempre la muestra de datos en el paso final antes de confirmar.
          </li>
        </ul>
      </div>

      {archivos.length > 0 && (
        <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Archivos seleccionados ({archivos.length})
            </h2>
            <span className="text-2xs text-slate-500">{formatearTamano(totalBytes)} total</span>
          </div>
          <ul className="space-y-2">
            {archivos.map((f, idx) => (
              <li
                key={idx}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 border border-slate-100"
              >
                {iconoArchivo(f.name)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate">{f.name}</p>
                  <p className="text-2xs text-slate-500">{formatearTamano(f.size)}</p>
                </div>
                <button
                  onClick={() => quitarArchivo(idx)}
                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                  aria-label="Quitar"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => inputFileRef.current?.click()}
            className="mt-3 text-sm text-violet-600 hover:text-violet-700 font-medium"
          >
            + Agregar más archivos
          </button>
        </div>
      )}

      <div className="mt-4 bg-white rounded-xl border border-slate-200">
        <button
          onClick={() => setOpcionesAbiertas((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-slate-700"
        >
          <span>Opciones avanzadas</span>
          {opcionesAbiertas ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        {opcionesAbiertas && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nota descriptiva
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Ej: Cartera SURA abril 2026"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={incremental}
                onChange={(e) => setIncremental(e.target.checked)}
              />
              <div>
                <span className="text-sm text-slate-700">
                  Esta importación actualiza una cartera existente (incremental)
                </span>
                <p className="text-2xs text-slate-500">
                  El sistema intentará vincular por DNI y actualizar registros existentes
                </p>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          className="btn-primary w-full py-4 text-base"
          disabled={archivos.length === 0 || subiendo}
          onClick={iniciarAnalisis}
        >
          <Sparkles className="w-5 h-5 inline-block mr-2" />
          Iniciar análisis
        </button>
        <p className="text-2xs text-slate-500 text-center mt-2">
          El sistema analizará la estructura de tus archivos con IA y te mostrará un plan de
          importación para que lo revises antes de procesar
        </p>
      </div>

      {modalInstruccionesAbierto && (
        <ModalInstrucciones onCerrar={() => setModalInstruccionesAbierto(false)} />
      )}
    </div>
  );
}

function ModalInstrucciones({ onCerrar }: { onCerrar: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-blue-50">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-700" />
            <h2 className="text-base font-semibold text-blue-900">
              Instrucciones del modelo de importación
            </h2>
          </div>
          <button
            onClick={onCerrar}
            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Cómo usar este modelo
            </h3>
            <ol className="space-y-2 text-sm text-slate-700 list-decimal list-inside">
              <li>
                Completá la hoja <strong>Clientes</strong> con los datos de cada persona o
                empresa.
              </li>
              <li>
                Completá la hoja <strong>Pólizas</strong> — una fila por cada póliza.
              </li>
              <li>
                Usá el mismo valor en <code className="px-1 py-0.5 bg-slate-100 rounded font-mono text-xs">dni_cuil</code> en ambas hojas para que se vinculen.
              </li>
              <li>
                Para Compañía, Ramo, Cobertura, Refacturación y Tipo de vigencia usá los nombres
                <strong> exactos </strong> de tus catálogos (Configuración → Catálogos). Si el
                archivo trae un valor que no está configurado, la importación se frena y te
                avisa.
              </li>
              <li>
                <strong>Borrá las 3 filas de ejemplo</strong> (en ámbar) antes de subir el
                archivo.
              </li>
              <li>
                Subí el archivo desde Herramientas → Importar. Las dos solapas se procesan
                juntas automáticamente.
              </li>
            </ol>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Reglas de formato
            </h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-200">
                {[
                  ['DNI / CUIL', 'Solo números, sin puntos ni guiones. Ej: 20123456781'],
                  ['Fechas', 'Formato AAAA-MM-DD. Ej: 2026-04-23'],
                  ['Montos', 'Solo números, sin símbolos ni separadores de miles. Ej: 1500000.50'],
                  ['Patente', 'Sin espacios. Ej: ABC123 o AB123CD'],
                  ['Clientes', 'Una persona por fila.'],
                  ['Pólizas', 'Una póliza por fila.'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-3 py-2 font-medium text-slate-700 bg-slate-50 w-40">{k}</td>
                    <td className="px-3 py-2 text-slate-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Campos obligatorios
            </h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="px-3 py-2 font-medium text-slate-700 bg-slate-50 w-40">Clientes</td>
                  <td className="px-3 py-2 text-slate-600 font-mono text-xs">
                    dni_cuil + apellido (o razon_social si es empresa)
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-slate-700 bg-slate-50 w-40">Pólizas</td>
                  <td className="px-3 py-2 text-slate-600 font-mono text-xs">
                    dni_cuil, numero_poliza, compania, ramo, fecha_inicio, fecha_fin
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Campos recomendados
            </h3>
            <p className="text-sm text-slate-700 mb-2">
              En <strong>Pólizas</strong>:{' '}
              <code className="px-1 py-0.5 bg-slate-100 rounded font-mono text-xs">
                cobertura, refacturacion, vigencia_tipo, moneda, tipo_riesgo
              </code>
            </p>
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <strong>Advertencia:</strong> si dejás estos campos vacíos, la importación
              funciona, pero las fichas del CRM quedan incompletas y vas a tener que
              completarlas a mano.
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Valores fijos del sistema
            </h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-200">
                {[
                  ['tipo_persona', 'FISICA  |  JURIDICA'],
                  ['estado (cliente)', 'PROSPECTO  |  ACTIVO  |  INACTIVO  |  BLOQUEADO'],
                  ['estado (póliza)', 'PROGRAMADA  |  RENOVADA  |  VIGENTE  |  NO_VIGENTE  |  CANCELADA  |  ANULADA'],
                  ['moneda', 'ARS  |  USD'],
                  [
                    'tipo_riesgo',
                    'AUTOMOTOR  |  MOTO  |  HOGAR  |  COMERCIO  |  VIDA  |  ACCIDENTES_PERSONALES  |  CAUCION  |  TRANSPORTE  |  EMBARCACION  |  TECNOLOGIA  |  ART  |  INTEGRAL_FAMILIA  |  GENERICO  |  OTRO',
                  ],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-3 py-2 font-medium text-slate-700 bg-slate-50 w-40 align-top">{k}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Campos de riesgo por tipo
            </h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-200">
                {[
                  ['AUTOMOTOR / MOTO', 'patente, marca, modelo, anio (+ motor, chasis, color, uso)'],
                  ['HOGAR', 'direccion_riesgo (+ tipo_construccion, superficie)'],
                  ['VIDA', 'capital_asegurado, beneficiarios'],
                  ['Otros ramos', 'descripcion_corta + suma_asegurada'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-3 py-2 font-medium text-slate-700 bg-slate-50 w-40 align-top">{k}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onCerrar}
            className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
