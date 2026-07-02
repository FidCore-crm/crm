'use client'

import { useEffect, useState } from 'react'
import { X, Save, Loader2, AlertCircle } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { tiposDeSiniestroPorRamo, obtenerConfigTipoSiniestro } from '@/lib/siniestros-catalogo'
import { CamposDinamicos, type ValoresDinamicos } from '@/components/siniestros/CamposDinamicos'

interface SiniestroParaEditar {
  id: string
  fecha_ocurrencia: string | null
  fecha_denuncia: string
  hora_siniestro: string | null
  tipo_siniestro: string
  monto_estimado: number | null
  monto_liquidado: number | null
  franquicia_aplicada: number | null
  monto_cobrado: number | null
  descripcion: string | null
  lugar_siniestro: string | null
  localidad_siniestro: string | null
  tercero_nombre: string | null
  tercero_dni: string | null
  tercero_telefono: string | null
  tercero_patente: string | null
  /** JSONB con datos específicos del tipo (conductor, tercero completo, testigos, campos custom, etc.). */
  detalle_siniestro?: Record<string, unknown> | null
  /** tipo_riesgo del ramo de la póliza (viene de poliza.ramo.metadata.tipo_riesgo). */
  tipo_riesgo?: string | null
}

interface Props {
  siniestro: SiniestroParaEditar
  abierto: boolean
  onCerrar: () => void
  onGuardado: () => void
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return ''
  return v.split('T')[0]
}

function toTimeInput(v: string | null | undefined): string {
  if (!v) return ''
  return v.split(':').slice(0, 2).join(':')
}

function toNumberInput(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n)
}

export default function EditarSiniestroModal({ siniestro, abierto, onCerrar, onGuardado }: Props) {
  const [fechaOcurrencia, setFechaOcurrencia] = useState('')
  const [fechaDenuncia, setFechaDenuncia] = useState('')
  const [horaSiniestro, setHoraSiniestro] = useState('')
  const [tipoSiniestro, setTipoSiniestro] = useState('')
  const [lugarSiniestro, setLugarSiniestro] = useState('')
  const [localidadSiniestro, setLocalidadSiniestro] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [montoEstimado, setMontoEstimado] = useState('')
  const [montoLiquidado, setMontoLiquidado] = useState('')
  const [franquiciaAplicada, setFranquiciaAplicada] = useState('')
  const [montoCobrado, setMontoCobrado] = useState('')
  const [terceroNombre, setTerceroNombre] = useState('')
  const [terceroDni, setTerceroDni] = useState('')
  const [terceroTelefono, setTerceroTelefono] = useState('')
  const [terceroPatente, setTerceroPatente] = useState('')

  // Valores del detalle_siniestro para edición dinámica según tipo.
  const [valoresDinamicos, setValoresDinamicos] = useState<ValoresDinamicos>({})

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [errorCampos, setErrorCampos] = useState<Record<string, string>>({})

  const tipoRiesgo = siniestro.tipo_riesgo || 'generico'
  const tiposValidos = tiposDeSiniestroPorRamo(tipoRiesgo)
  const configTipo = obtenerConfigTipoSiniestro(tipoRiesgo, tipoSiniestro)
  const tieneCamposDinamicos = configTipo !== null && (configTipo.bloques.length > 0 || configTipo.campos.length > 0)

  useEffect(() => {
    if (!abierto) return
    setFechaOcurrencia(toDateInput(siniestro.fecha_ocurrencia))
    setFechaDenuncia(toDateInput(siniestro.fecha_denuncia))
    setHoraSiniestro(toTimeInput(siniestro.hora_siniestro))
    setTipoSiniestro(siniestro.tipo_siniestro || '')
    setLugarSiniestro(siniestro.lugar_siniestro || '')
    setLocalidadSiniestro(siniestro.localidad_siniestro || '')
    setDescripcion(siniestro.descripcion || '')
    setMontoEstimado(toNumberInput(siniestro.monto_estimado))
    setMontoLiquidado(toNumberInput(siniestro.monto_liquidado))
    setFranquiciaAplicada(toNumberInput(siniestro.franquicia_aplicada))
    setMontoCobrado(toNumberInput(siniestro.monto_cobrado))
    setTerceroNombre(siniestro.tercero_nombre || '')
    setTerceroDni(siniestro.tercero_dni || '')
    setTerceroTelefono(siniestro.tercero_telefono || '')
    setTerceroPatente(siniestro.tercero_patente || '')
    // Cargar valoresDinamicos desde el detalle_siniestro (si viene).
    // Filtramos las keys que ya editan campos estructurales (tercero_*, etc.) para no duplicar.
    const detalle = (siniestro.detalle_siniestro ?? {}) as Record<string, unknown>
    const KEYS_NO_DINAMICAS = new Set([
      'tipo_riesgo', 'tipo_otro_descripcion', 'denuncia_policial', 'acta_policial',
      // Estos se editan directo en las columnas planas del modal.
    ])
    const dinamicos: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(detalle)) {
      if (!KEYS_NO_DINAMICAS.has(k)) dinamicos[k] = v
    }
    setValoresDinamicos(dinamicos as ValoresDinamicos)
    setError('')
    setErrorCampos({})
  }, [abierto, siniestro])

  useEffect(() => {
    if (!abierto) return
    const handler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [abierto, onCerrar])

  async function guardar() {
    setError(''); setErrorCampos({})
    setGuardando(true)
    const body: Record<string, any> = {
      fecha_ocurrencia: fechaOcurrencia || null,
      fecha_denuncia: fechaDenuncia,
      hora_siniestro: horaSiniestro || null,
      tipo_siniestro: tipoSiniestro || null,
      lugar_siniestro: lugarSiniestro.trim() || null,
      localidad_siniestro: localidadSiniestro.trim() || null,
      descripcion: descripcion.trim(),
      monto_estimado: montoEstimado ? parseFloat(montoEstimado) : null,
      monto_liquidado: montoLiquidado ? parseFloat(montoLiquidado) : null,
      franquicia_aplicada: franquiciaAplicada ? parseFloat(franquiciaAplicada) : null,
      monto_cobrado: montoCobrado ? parseFloat(montoCobrado) : null,
      tercero_nombre: terceroNombre.trim() || null,
      tercero_dni: terceroDni.trim() || null,
      tercero_telefono: terceroTelefono.trim() || null,
      tercero_patente: terceroPatente.trim().toUpperCase() || null,
    }

    // Construir el detalle_siniestro final: preservamos las keys que el modal
    // no toca (tipo_riesgo, tipo_otro_descripcion, denuncia/acta policial)
    // y mergeamos los valores dinámicos editados.
    const detalleOriginal = (siniestro.detalle_siniestro ?? {}) as Record<string, unknown>
    const detalleFinal: Record<string, unknown> = {
      // Preservar keys estructurales
      tipo_riesgo: detalleOriginal.tipo_riesgo,
      tipo_otro_descripcion: detalleOriginal.tipo_otro_descripcion,
      denuncia_policial: detalleOriginal.denuncia_policial,
      acta_policial: detalleOriginal.acta_policial,
      // Mergear valores editados desde CamposDinamicos
      ...valoresDinamicos,
    }
    // Limpiar undefined del objeto final
    for (const k of Object.keys(detalleFinal)) {
      if (detalleFinal[k] === undefined) delete detalleFinal[k]
    }
    body.detalle_siniestro = detalleFinal
    const r = await apiCall(
      `/api/siniestros/${siniestro.id}`,
      { method: 'PATCH', body },
      { mostrar_toast_en_error: false },
    )
    setGuardando(false)
    if (!r.ok) {
      setError(r.error?.mensaje ?? 'No se pudo guardar')
      if (r.error?.campos) setErrorCampos(r.error.campos)
      return
    }
    toast.exito('Siniestro actualizado')
    onGuardado()
    onCerrar()
  }

  if (!abierto) return null

  const errClass = (campo: string) => errorCampos[campo] ? 'border-red-300' : ''

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-siniestro-titulo"
      onClick={onCerrar}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 id="editar-siniestro-titulo" className="text-base font-semibold text-slate-800">Editar siniestro</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex flex-col gap-5">
          {error && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
            </div>
          )}

          {/* Fechas + tipo */}
          <section>
            <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Fechas y tipo</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de ocurrencia</label>
                <input type="date" className={`form-input ${errClass('fecha_ocurrencia')}`} value={fechaOcurrencia}
                  onChange={e => setFechaOcurrencia(e.target.value)} />
                {errorCampos.fecha_ocurrencia && <span className="text-xs text-red-500">{errorCampos.fecha_ocurrencia}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de denuncia *</label>
                <input type="date" className={`form-input ${errClass('fecha_denuncia')}`} value={fechaDenuncia}
                  onChange={e => setFechaDenuncia(e.target.value)} />
                {errorCampos.fecha_denuncia && <span className="text-xs text-red-500">{errorCampos.fecha_denuncia}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hora del siniestro</label>
                <input type="time" className="form-input" value={horaSiniestro}
                  onChange={e => setHoraSiniestro(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de siniestro</label>
                <select className="form-input" value={tipoSiniestro} onChange={e => setTipoSiniestro(e.target.value)}>
                  <option value="">— Sin tipo —</option>
                  {tiposValidos.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.icono ? `${t.icono} ${t.label}` : t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Lugar */}
          <section>
            <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Lugar del hecho</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Lugar (calle / referencia)</label>
                <input type="text" className="form-input" value={lugarSiniestro}
                  onChange={e => setLugarSiniestro(e.target.value)}
                  placeholder="Av. Rivadavia y Carabobo" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Localidad</label>
                <input type="text" className="form-input" value={localidadSiniestro}
                  onChange={e => setLocalidadSiniestro(e.target.value)}
                  placeholder="Caballito" />
              </div>
            </div>
          </section>

          {/* Descripción */}
          <section>
            <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Relato</h3>
            <textarea
              className={`form-input min-h-[80px] ${errClass('descripcion')}`}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Cómo ocurrió el siniestro..."
            />
            {errorCampos.descripcion && <span className="text-xs text-red-500">{errorCampos.descripcion}</span>}
          </section>

          {/* Montos */}
          <section>
            <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Montos</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Estimado</label>
                <input type="number" min="0" step="0.01" className={`form-input ${errClass('monto_estimado')}`}
                  value={montoEstimado} onChange={e => setMontoEstimado(e.target.value)} />
                {errorCampos.monto_estimado && <span className="text-xs text-red-500">{errorCampos.monto_estimado}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Liquidado</label>
                <input type="number" min="0" step="0.01" className={`form-input ${errClass('monto_liquidado')}`}
                  value={montoLiquidado} onChange={e => setMontoLiquidado(e.target.value)} />
                {errorCampos.monto_liquidado && <span className="text-xs text-red-500">{errorCampos.monto_liquidado}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Franquicia</label>
                <input type="number" min="0" step="0.01" className={`form-input ${errClass('franquicia_aplicada')}`}
                  value={franquiciaAplicada} onChange={e => setFranquiciaAplicada(e.target.value)} />
                {errorCampos.franquicia_aplicada && <span className="text-xs text-red-500">{errorCampos.franquicia_aplicada}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cobrado</label>
                <input type="number" min="0" step="0.01" className={`form-input ${errClass('monto_cobrado')}`}
                  value={montoCobrado} onChange={e => setMontoCobrado(e.target.value)} />
                {errorCampos.monto_cobrado && <span className="text-xs text-red-500">{errorCampos.monto_cobrado}</span>}
              </div>
            </div>
          </section>

          {/* Detalle del siniestro (dinámico según tipo) */}
          {tieneCamposDinamicos && configTipo && (
            <section>
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {configTipo.icono} Datos de {configTipo.label.toLowerCase()}
              </h3>
              <CamposDinamicos
                tipoRiesgo={tipoRiesgo}
                tipoSiniestro={tipoSiniestro}
                valores={valoresDinamicos}
                onChange={setValoresDinamicos}
                errores={errorCampos}
              />
            </section>
          )}

          {/* Tercero (columnas planas — se mantienen para búsqueda + reporting) */}
          <section>
            <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Datos del tercero (columnas indexadas)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre y apellido</label>
                <input type="text" className="form-input" value={terceroNombre}
                  onChange={e => setTerceroNombre(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">DNI</label>
                <input type="text" className={`form-input ${errClass('tercero_dni')}`} value={terceroDni}
                  onChange={e => setTerceroDni(e.target.value)} />
                {errorCampos.tercero_dni && <span className="text-xs text-red-500">{errorCampos.tercero_dni}</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                <input type="tel" className="form-input" value={terceroTelefono}
                  onChange={e => setTerceroTelefono(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Patente</label>
                <input type="text" className={`form-input uppercase ${errClass('tercero_patente')}`} value={terceroPatente}
                  onChange={e => setTerceroPatente(e.target.value.toUpperCase())} />
                {errorCampos.tercero_patente && <span className="text-xs text-red-500">{errorCampos.tercero_patente}</span>}
              </div>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onCerrar} className="btn-secondary">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="btn-primary flex items-center gap-1.5">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
