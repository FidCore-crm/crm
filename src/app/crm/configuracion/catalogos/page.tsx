'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  Plus, Pencil, Trash2, Save, X, Loader2, AlertCircle,
  CheckCircle, ChevronRight, Settings, GripVertical,
  ToggleLeft, ToggleRight, Type, AlignLeft, List, Calendar,
  ArrowLeft, Info
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { TIPOS_RIESGO, obtenerTipoRiesgo } from '@/lib/tipos-riesgo'
import { generarCodigoUnico } from '@/lib/catalogos-codigo'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'
import { toast } from '@/lib/toast'
import { logger } from '@/lib/errores/logger'
import { EstadoCarga } from '@/components/EstadoCarga'

// ── Tipos ────────────────────────────────────────────────────
interface TipoCatalogo { id: string; codigo: string; descripcion: string | null }
interface Catalogo {
  id: string; tipo_id: string; nombre: string; codigo: string | null
  activo: boolean; metadata: Record<string, any> | null; orden: number
}
interface CampoSiniestro {
  key:         string
  label:       string
  tipo:        'text' | 'textarea' | 'select' | 'date'
  requerido:   boolean
  placeholder?: string
  opciones?:   string // opciones separadas por coma (para tipo select)
}

const TIPOS_CAMPO = [
  { value: 'text',     label: 'Texto corto',     icon: <Type       className="h-3 w-3" /> },
  { value: 'textarea', label: 'Texto largo',      icon: <AlignLeft  className="h-3 w-3" /> },
  { value: 'select',   label: 'Lista de opciones', icon: <List       className="h-3 w-3" /> },
  { value: 'date',     label: 'Fecha',            icon: <Calendar   className="h-3 w-3" /> },
]

// Los campos por default del siniestro (y los campos del formulario de
// póliza) viven en src/lib/tipos-riesgo.ts. Acá los leemos via
// `obtenerTipoRiesgo()` para no duplicar el catálogo.

// ── Componente editor de campos ──────────────────────────────
function EditorCampos({ campos, onChange }: {
  campos: CampoSiniestro[]
  onChange: (campos: CampoSiniestro[]) => void
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [formCampo, setFormCampo] = useState<CampoSiniestro>({
    key: '', label: '', tipo: 'text', requerido: false, placeholder: '', opciones: ''
  })
  const [agregando, setAgregando] = useState(false)
  const [errorCampo, setErrorCampo] = useState('')

  const abrirNuevo = () => {
    setFormCampo({ key: '', label: '', tipo: 'text', requerido: false, placeholder: '', opciones: '' })
    setAgregando(true); setEditIdx(null); setErrorCampo('')
  }

  const abrirEdicion = (i: number) => {
    setFormCampo({ ...campos[i], opciones: campos[i].opciones ?? '' })
    setEditIdx(i); setAgregando(false); setErrorCampo('')
  }

  const cancelar = () => { setAgregando(false); setEditIdx(null); setErrorCampo('') }

  const guardarCampo = () => {
    if (!formCampo.label.trim()) { setErrorCampo('El nombre del campo es obligatorio'); return }
    const key = formCampo.key.trim() || formCampo.label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const nuevo = { ...formCampo, key }

    if (editIdx !== null) {
      const arr = [...campos]; arr[editIdx] = nuevo; onChange(arr)
    } else {
      onChange([...campos, nuevo])
    }
    cancelar()
  }

  const eliminar = (i: number) => {
    if (!confirm('¿Eliminar este campo?')) return
    onChange(campos.filter((_, idx) => idx !== i))
  }

  const toggleRequerido = (i: number) => {
    const arr = [...campos]; arr[i] = { ...arr[i], requerido: !arr[i].requerido }; onChange(arr)
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">
          Campos del formulario de siniestros
        </p>
        <button onClick={abrirNuevo} className="btn-secondary text-2xs px-2 py-1">
          <Plus className="h-3 w-3" /> Agregar campo
        </button>
      </div>

      {/* Lista de campos */}
      {campos.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-2">Sin campos configurados — el formulario usará descripción genérica.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {campos.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
              <GripVertical className="h-3 w-3 text-slate-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-700 truncate">{c.label}</span>
                  <span className="text-2xs text-slate-500 bg-slate-100 px-1 rounded">
                    {TIPOS_CAMPO.find(t => t.value === c.tipo)?.label ?? c.tipo}
                  </span>
                  {c.requerido && (
                    <span className="text-2xs text-red-500 bg-red-50 border border-red-200 px-1 rounded">obligatorio</span>
                  )}
                </div>
                {c.placeholder && <p className="text-2xs text-slate-500 truncate mt-0.5">{c.placeholder}</p>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => toggleRequerido(i)}
                  className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${c.requerido ? 'text-red-500 hover:bg-red-50' : 'text-slate-300 hover:bg-slate-100'}`}
                  title={c.requerido ? 'Quitar obligatorio' : 'Marcar obligatorio'}>
                  {c.requerido ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => abrirEdicion(i)}
                  className="btn-tabla-accion">
                  <Pencil />
                </button>
                <button onClick={() => eliminar(i)}
                  className="btn-tabla-accion-danger">
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulario inline de campo */}
      {(agregando || editIdx !== null) && (
        <div className="border border-blue-200 bg-blue-50 rounded p-3 flex flex-col gap-2 mt-1">
          <p className="text-xs font-semibold text-blue-700">{editIdx !== null ? 'Editar campo' : 'Nuevo campo'}</p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-600 mb-0.5 block">Nombre del campo <span className="text-red-500">*</span></label>
              <input className="form-input w-full" value={formCampo.label}
                onChange={e => setFormCampo(f => ({ ...f, label: e.target.value }))}
                placeholder="Ej: Lugar del hecho" autoFocus />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-0.5 block">Tipo de campo</label>
              <select className="form-input w-full" value={formCampo.tipo}
                onChange={e => setFormCampo(f => ({ ...f, tipo: e.target.value as any }))}>
                {TIPOS_CAMPO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-600 mb-0.5 block">Texto de ayuda (opcional)</label>
            <input className="form-input w-full" value={formCampo.placeholder ?? ''}
              onChange={e => setFormCampo(f => ({ ...f, placeholder: e.target.value }))}
              placeholder="Ej: Ingresá la dirección donde ocurrió..." />
          </div>

          {formCampo.tipo === 'select' && (
            <div>
              <label className="text-xs text-slate-600 mb-0.5 block">
                Opciones <span className="text-slate-500">(separadas por coma)</span>
              </label>
              <input className="form-input w-full" value={formCampo.opciones ?? ''}
                onChange={e => setFormCampo(f => ({ ...f, opciones: e.target.value }))}
                placeholder="Opción 1,Opción 2,Opción 3" />
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={formCampo.requerido}
              onChange={e => setFormCampo(f => ({ ...f, requerido: e.target.checked }))}
              className="rounded border-slate-300" />
            Campo obligatorio (el formulario no deja guardar si está vacío)
          </label>

          {errorCampo && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />{errorCampo}
            </span>
          )}

          <div className="flex gap-2">
            <button onClick={guardarCampo} className="btn-primary">
              <Save className="h-3 w-3" /> Guardar campo
            </button>
            <button onClick={cancelar} className="btn-secondary">
              <X className="h-3 w-3" /> Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Solo los 3 tipos de catálogo que el PAS configura desde esta pantalla.
// VIGENCIA y REFACTURACION fueron eliminados (migración 095): vigencia se calcula
// desde fecha_inicio/fecha_fin y refacturación es enum hardcoded (ver refacturaciones.ts).
const TIPOS_RELEVANTES = ['COMPANIA', 'RAMO', 'COBERTURA']

// ── Página principal ─────────────────────────────────────────
export default function CatalogosPage() {
  const supabase = getSupabaseClient()
  const router = useRouter()
  const { isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/crm/dashboard')
  }, [authLoading, isAdmin, router])

  const [tipos,         setTipos]         = useState<TipoCatalogo[]>([])
  const [tipoActivo,    setTipoActivo]    = useState<TipoCatalogo | null>(null)
  const [catalogos,     setCatalogos]     = useState<Catalogo[]>([])
  const [cargando,      setCargando]      = useState(true)
  const [cargandoItems, setCargandoItems] = useState(false)
  // Error de carga inicial (tipos + auxiliares). Si aparece, el <EstadoCarga>
  // muestra un mensaje con botón de reintento en vez de la UI de la pantalla.
  const [errorCarga,    setErrorCarga]    = useState<{ codigo?: string; mensaje: string } | null>(null)
  // Contador que fuerza re-fetch cuando el usuario aprieta "Reintentar".
  const [reintentoKey,  setReintentoKey]  = useState(0)
  const [editando,      setEditando]      = useState<string | null>(null)
  const [agregando,     setAgregando]     = useState(false)
  const [formNombre,    setFormNombre]    = useState('')
  const [formTipoRiesgo, setFormTipoRiesgo] = useState('')
  const [formCampos,    setFormCampos]    = useState<CampoSiniestro[]>([])
  const [error,         setError]         = useState('')
  const [guardando,     setGuardando]     = useState(false)
  const [exito,         setExito]         = useState('')

  const [ramosDisponibles,    setRamosDisponibles]    = useState<Catalogo[]>([])
  const [companiasDisponibles, setCompaniasDisponibles] = useState<Catalogo[]>([])
  const [formRamoIds,        setFormRamoIds]          = useState<string[]>([])
  const [formEquivalencias,  setFormEquivalencias]    = useState<{ compania_id: string; nombre_comercial: string }[]>([])
  // Descripción breve y lista de bullets ("qué cubre") — se usan para
  // enriquecer el PDF de cotización con un detalle de cada cobertura.
  const [formDescripcion,    setFormDescripcion]      = useState('')
  const [formCubre,          setFormCubre]            = useState<string[]>([])

  const esRamo      = tipoActivo?.codigo === 'RAMO'
  const esCobertura = tipoActivo?.codigo === 'COBERTURA'

  useEffect(() => {
    async function cargarTipos() {
      const { data, error } = await supabase.from('tipo_catalogo').select('id, codigo, descripcion')
      if (error) {
        logger.error({
          modulo: 'catalogos',
          mensaje: 'Falló carga de tipo_catalogo',
          contexto: { error: error.message },
        })
        setErrorCarga({ mensaje: 'No se pudieron cargar los tipos de catálogo. Revisá la conexión y volvé a intentar.' })
        setCargando(false)
        return
      }
      // Ordenar según TIPOS_RELEVANTES (Compañías → Ramos → Coberturas),
      // que es el orden de configuración esperado por el PAS.
      const ordenados = ((data ?? []) as TipoCatalogo[])
        .filter(t => TIPOS_RELEVANTES.includes(t.codigo))
        .sort((a, b) => TIPOS_RELEVANTES.indexOf(a.codigo) - TIPOS_RELEVANTES.indexOf(b.codigo))
      setTipos(ordenados)
      if (ordenados.length > 0) setTipoActivo(ordenados[0])
      setCargando(false)
    }
    cargarTipos()
  }, [supabase, reintentoKey])

  const cargarCatalogos = useCallback(async (silencioso: boolean = false) => {
    if (!tipoActivo) return
    if (!silencioso) setCargandoItems(true)
    const { data, error } = await supabase.from('catalogos').select('*').eq('tipo_id', tipoActivo.id).order('orden').order('nombre')
    if (error) {
      logger.error({
        modulo: 'catalogos',
        mensaje: 'Falló carga de catálogos del tipo activo',
        contexto: { tipo: tipoActivo.codigo, error: error.message },
      })
      toast.error({ mensaje: `No se pudieron cargar los ${tipoActivo.codigo.toLowerCase()}s. Reintentá en unos segundos.` })
      setCargandoItems(false)
      return
    }
    setCatalogos((data ?? []) as Catalogo[])
    setCargandoItems(false)
  }, [supabase, tipoActivo])

  useEffect(() => { cargarCatalogos() }, [cargarCatalogos])

  // Realtime: cambios de otros admins se reflejan en el acto (además el resto
  // del CRM se entera vía la publicación — dropdowns de ramo/cobertura, etc.).
  useRealtimeRefresh({ tablas: ['catalogos'], onCambio: () => cargarCatalogos(true) })

  // Cargar ramos y compañías disponibles (para vincular coberturas)
  useEffect(() => {
    async function cargarAuxiliares() {
      const { data: tiposCat, error: errTipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (errTipos) {
        logger.error({
          modulo: 'catalogos',
          mensaje: 'Falló carga auxiliar de tipo_catalogo',
          contexto: { error: errTipos.message },
        })
        return
      }
      const tipoRamo = ((tiposCat ?? []) as TipoCatalogo[]).find(t => t.codigo === 'RAMO')
      const tipoComp = ((tiposCat ?? []) as TipoCatalogo[]).find(t => t.codigo === 'COMPANIA')
      const [{ data: rams, error: errRams }, { data: comps, error: errComps }] = await Promise.all([
        tipoRamo ? supabase.from('catalogos').select('id, tipo_id, nombre, codigo, activo, metadata, orden')
          .eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [], error: null }),
        tipoComp ? supabase.from('catalogos').select('id, tipo_id, nombre, codigo, activo, metadata, orden')
          .eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [], error: null }),
      ])
      // Ramos/compañías se usan solo al editar coberturas — si fallan, dejamos
      // vacío y el editor mostrará listas vacías (mejor que crashear).
      if (errRams) {
        logger.warn({ modulo: 'catalogos', mensaje: 'Falló carga de ramos disponibles', contexto: { error: errRams.message } })
      } else {
        setRamosDisponibles((rams ?? []) as Catalogo[])
      }
      if (errComps) {
        logger.warn({ modulo: 'catalogos', mensaje: 'Falló carga de compañías disponibles', contexto: { error: errComps.message } })
      } else {
        setCompaniasDisponibles((comps ?? []) as Catalogo[])
      }
    }
    cargarAuxiliares()
  }, [supabase, reintentoKey])

  const resetForm = () => {
    setEditando(null); setAgregando(false)
    setFormNombre(''); setFormTipoRiesgo(''); setFormCampos([]); setFormRamoIds([]); setFormEquivalencias([])
    setFormDescripcion(''); setFormCubre([]); setError('')
  }

  const iniciarEdicion = (c: Catalogo) => {
    setEditando(c.id); setAgregando(false)
    setFormNombre(c.nombre)
    setFormTipoRiesgo(c.metadata?.tipo_riesgo ?? '')
    setFormCampos(c.metadata?.campos_siniestro ?? [])
    setFormRamoIds(c.metadata?.ramo_ids ?? [])
    setFormEquivalencias(c.metadata?.equivalencias ?? [])
    setFormDescripcion(c.metadata?.descripcion ?? '')
    setFormCubre(Array.isArray(c.metadata?.cubre) ? c.metadata.cubre : [])
    setError('')
  }

  const iniciarAgregado = () => {
    resetForm(); setAgregando(true)
  }

  // Cuando cambia el tipo de riesgo, ofrecer reemplazar los campos del SINIESTRO
  // por los defaults del tipo nuevo. Si el editor está vacío, lo hace en silencio;
  // si ya hay campos cargados, pide confirmación para no pisar lo que el PAS
  // configuró por error.
  const handleTipoRiesgoChange = (valor: string) => {
    setFormTipoRiesgo(valor)
    if (!valor) return

    const defaults = (obtenerTipoRiesgo(valor).campos_siniestro_default ?? []) as CampoSiniestro[]

    if (formCampos.length === 0) {
      setFormCampos(defaults)
      return
    }

    const reemplazar = confirm(
      'Cambiaste el tipo de riesgo. ¿Querés reemplazar los campos actuales del siniestro por los sugeridos para este tipo?\n\n' +
      'Aceptar: cargo los campos sugeridos (perdés los actuales).\n' +
      'Cancelar: mantengo los campos que tenías.'
    )
    if (reemplazar) setFormCampos(defaults)
  }

  const guardar = async () => {
    if (!formNombre.trim()) { setError('El nombre es obligatorio'); return }
    if (!tipoActivo) return
    setGuardando(true); setError('')

    // Genera código único deduplicando contra otras entradas del mismo tipo.
    // Para edición pasamos `editando` para que el slug propio no choque
    // consigo mismo (si el nombre no cambió, el código queda igual).
    const codigoFinal = await generarCodigoUnico(
      supabase,
      formNombre.trim(),
      tipoActivo.id,
      editando ?? undefined,
    )

    // Construir metadata
    let metadata: Record<string, any> = {}
    if (esRamo) {
      metadata = {
        tipo_riesgo:      formTipoRiesgo || null,
        campos_siniestro: formCampos,
      }
    } else if (esCobertura) {
      metadata = {
        ramo_ids: formRamoIds,
        equivalencias: formEquivalencias.filter(e => e.compania_id && e.nombre_comercial.trim()),
        descripcion: formDescripcion.trim() || null,
        cubre: formCubre.map(s => s.trim()).filter(s => s.length > 0),
      }
    }

    const payload = {
      tipo_id:  tipoActivo.id,
      nombre:   formNombre.trim(),
      codigo:   codigoFinal,
      metadata: metadata,
      activo:   true,
      orden:    catalogos.length + 1,
    }

    // En edición regeneramos también el `codigo` — esto corrige casos
    // históricos donde el nombre cambió pero el código quedó viejo
    // (ej: ramo "Moto" con código "AUTO" porque originalmente se llamaba
    // "Auto" antes de renombrarlo).
    const { error: e } = editando
      ? await supabase.from('catalogos').update({ nombre: payload.nombre, codigo: codigoFinal, metadata: payload.metadata }).eq('id', editando)
      : await supabase.from('catalogos').insert(payload)

    if (e) { setError(`Error: ${e.message}`) }
    else { setExito(editando ? 'Actualizado ✓' : 'Agregado ✓'); setTimeout(() => setExito(''), 2500); resetForm(); cargarCatalogos(true) }
    setGuardando(false)
  }

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return
    const { error } = await supabase.from('catalogos').delete().eq('id', id)
    if (error) {
      logger.error({
        modulo: 'catalogos',
        mensaje: 'Falló eliminación de catálogo',
        contexto: { id, nombre, error: error.message },
      })
      // Los deletes fallan típicamente por FK: el catálogo está en uso por
      // pólizas históricas, cotizaciones, etc. Damos un mensaje claro en vez
      // de silenciar.
      const mensajeUsuario = error.message.toLowerCase().includes('foreign key')
        ? `No se puede eliminar "${nombre}" porque hay registros que lo usan. Considerá desactivarlo en lugar de eliminarlo.`
        : `No se pudo eliminar "${nombre}". Reintentá en unos segundos.`
      toast.error({ mensaje: mensajeUsuario })
      return
    }
    toast.exito(`"${nombre}" eliminado`)
    cargarCatalogos(true)
  }

  const toggleActivo = async (id: string, activo: boolean, nombre: string) => {
    // Si estamos desactivando, verificar impacto en pólizas activas
    if (activo && tipoActivo) {
      const tipoCodigo = tipoActivo.codigo
      let columnaFK: string | null = null
      if (tipoCodigo === 'COMPANIA') columnaFK = 'compania_id'
      else if (tipoCodigo === 'RAMO') columnaFK = 'ramo_id'
      else if (tipoCodigo === 'COBERTURA') columnaFK = 'cobertura_id'

      if (columnaFK) {
        const { count, error: errCount } = await supabase
          .from('polizas')
          .select('*', { count: 'exact', head: true })
          .eq(columnaFK, id)
          .in('estado', ['VIGENTE', 'PROGRAMADA', 'RENOVADA'])

        if (errCount) {
          logger.error({
            modulo: 'catalogos',
            mensaje: 'Falló chequeo de impacto al desactivar catálogo',
            contexto: { id, nombre, error: errCount.message },
          })
          toast.error({ mensaje: `No se pudo verificar el impacto de desactivar "${nombre}". Reintentá en unos segundos.` })
          return
        }

        if (count && count > 0) {
          const confirmar = confirm(
            `"${nombre}" tiene ${count} póliza(s) activa(s) que la referencian.\n\n¿Estás seguro de desactivarla? Las pólizas existentes mantendrán la referencia pero no se podrá seleccionar en nuevos formularios.`
          )
          if (!confirmar) return
        }
      }
    }
    const { error } = await supabase.from('catalogos').update({ activo: !activo }).eq('id', id)
    if (error) {
      logger.error({
        modulo: 'catalogos',
        mensaje: 'Falló toggle de activo en catálogo',
        contexto: { id, nombre, error: error.message },
      })
      toast.error({ mensaje: `No se pudo ${activo ? 'desactivar' : 'activar'} "${nombre}". Reintentá en unos segundos.` })
      return
    }
    toast.exito(`"${nombre}" ${activo ? 'desactivado' : 'activado'}`)
    cargarCatalogos(true)
  }

  // Estado de carga inicial (tipos) y error. Envolvemos con <EstadoCarga> para
  // ser consistente con el resto del CRM: spinner mientras carga, mensaje +
  // botón "Reintentar" si falla.
  if (cargando || errorCarga) return (
    <EstadoCarga
      loading={cargando}
      error={errorCarga}
      empty={false}
      onReintentar={() => {
        setErrorCarga(null)
        setCargando(true)
        setReintentoKey(k => k + 1)
      }}
    >
      <div />
    </EstadoCarga>
  )

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => router.push('/crm/configuracion')}
        className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-700 w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver
      </button>
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Catálogos del Sistema</h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Administrá compañías, ramos y coberturas. Los cambios impactan en todos los formularios al instante.
        </p>
      </div>

      <div className="flex gap-3">
        {/* Tipos */}
        <div className="w-48 shrink-0 flex flex-col gap-1">
          <p className="text-2xs font-semibold text-slate-600 uppercase tracking-wide px-1 mb-1">Tipo</p>
          {tipos.map(tipo => (
            <button key={tipo.id} onClick={() => { setTipoActivo(tipo); resetForm() }}
              className={`flex items-center justify-between px-3 py-2 rounded text-xs transition-all ${
                tipoActivo?.id === tipo.id ? 'bg-slate-800 text-white font-medium' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
              }`}>
              <span>{tipo.descripcion ?? tipo.codigo}</span>
              {tipoActivo?.id === tipo.id && <ChevronRight className="h-3 w-3" />}
            </button>
          ))}
        </div>

        {/* Panel derecho */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Cartel explicativo según el tipo activo */}
          {esRamo && (
            <div className="bg-indigo-50 border border-indigo-200 rounded p-3 flex gap-2.5">
              <Info className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-900 leading-relaxed">
                <p className="font-semibold mb-1">¿Qué es un ramo?</p>
                <p>Un ramo es una categoría comercial de seguro: Automotor, Hogar, Moto, Vida, etc. Cada póliza pertenece a un ramo.</p>
                <p className="mt-1.5">Al crear un ramo definís 2 cosas:</p>
                <ul className="mt-1 pl-4 list-disc">
                  <li><strong>Tipo de bien:</strong> qué categoría de datos pide el sistema al cargar una póliza de ese ramo (patente y marca para autos, dirección y superficie para hogar, etc.).</li>
                  <li><strong>Datos del siniestro:</strong> qué información cargar cuando hay un siniestro de ese ramo (lugar del hecho, terceros, etc.).</li>
                </ul>
              </div>
            </div>
          )}
          {esCobertura && (
            <div className="bg-indigo-50 border border-indigo-200 rounded p-3 flex gap-2.5">
              <Info className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-900 leading-relaxed">
                <p className="font-semibold mb-1">¿Qué es una cobertura?</p>
                <p>Una cobertura es el tipo de protección que ofrece una póliza (Todo Riesgo, Terceros Completos, etc.). Cada cobertura se asocia a uno o varios ramos — solo aparece en el formulario de póliza cuando el ramo seleccionado la incluye.</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-2">
            <div>
              <span className="text-sm font-medium text-slate-700">{tipoActivo?.descripcion ?? tipoActivo?.codigo}</span>
              <span className="ml-2 text-xs text-slate-500">{catalogos.length} elementos</span>
            </div>
            <div className="flex items-center gap-2">
              {exito && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3 w-3" />{exito}</span>}
              <button onClick={iniciarAgregado} className="btn-primary"><Plus className="h-3 w-3" /> Agregar</button>
            </div>
          </div>

          {/* Formulario inline */}
          {(agregando || editando) && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-blue-700">
                {editando ? 'Editar elemento' : `Agregar a ${tipoActivo?.descripcion}`}
              </p>

              <div>
                <label className="text-xs text-slate-600 mb-0.5 block">Nombre <span className="text-red-500">*</span></label>
                <input autoFocus className="form-input w-full" value={formNombre}
                  onChange={e => { setFormNombre(e.target.value); setError('') }}
                  placeholder={esRamo ? 'Ej: Automotores' : 'Ej: Sancor Seguros'}
                  onKeyDown={e => e.key === 'Enter' && !esRamo && guardar()} />
              </div>

              {/* Solo para Coberturas: vincular con ramos */}
              {esCobertura && (
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">
                    Ramos asociados
                    <span className="ml-1 text-slate-500">(esta cobertura aparecerá solo en los ramos seleccionados)</span>
                  </label>
                  {ramosDisponibles.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No hay ramos cargados — agregalos primero.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 bg-white border border-slate-200 rounded p-2">
                      {ramosDisponibles.map(r => (
                        <label key={r.id} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                          <input type="checkbox" checked={formRamoIds.includes(r.id)}
                            onChange={e => setFormRamoIds(ids =>
                              e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id)
                            )}
                            className="rounded border-slate-300" />
                          {r.nombre}
                        </label>
                      ))}
                    </div>
                  )}
                  {formRamoIds.length === 0 && (
                    <p className="text-2xs text-amber-600 mt-1">
                      Sin ramos asociados — la cobertura no aparecerá en ningún formulario de póliza.
                    </p>
                  )}
                </div>
              )}

              {/* Solo para Coberturas: equivalencias por compañía */}
              {esCobertura && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-600">
                      Nombres por compañía
                      <span className="ml-1 text-slate-500">(nombre comercial que usa cada aseguradora)</span>
                    </label>
                    <button onClick={() => setFormEquivalencias(eq => [...eq, { compania_id: '', nombre_comercial: '' }])}
                      className="btn-secondary text-2xs px-2 py-1">
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  {formEquivalencias.length === 0 ? (
                    <p className="text-xs text-slate-500 italic py-1">Sin equivalencias — se usará el nombre genérico en todas las compañías.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {formEquivalencias.map((eq, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select className="form-input flex-1" value={eq.compania_id}
                            onChange={e => setFormEquivalencias(eqs => eqs.map((x, idx) => idx === i ? { ...x, compania_id: e.target.value } : x))}>
                            <option value="">— Compañía —</option>
                            {companiasDisponibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                          <input className="form-input flex-1" value={eq.nombre_comercial}
                            onChange={e => setFormEquivalencias(eqs => eqs.map((x, idx) => idx === i ? { ...x, nombre_comercial: e.target.value } : x))}
                            placeholder="Nombre comercial (ej: CF, C-Clima)" />
                          <button onClick={() => setFormEquivalencias(eqs => eqs.filter((_, idx) => idx !== i))}
                            className="h-7 w-7 flex items-center justify-center rounded text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Solo para Coberturas: descripción + bullets de "qué cubre" */}
              {esCobertura && (
                <div className="border-t border-blue-200 pt-3">
                  <label className="text-xs text-slate-600 mb-1 block">
                    Descripción breve
                    <span className="ml-1 text-slate-500">(aparece en el PDF de cotización debajo del nombre)</span>
                  </label>
                  <textarea
                    className="form-input w-full"
                    rows={2}
                    value={formDescripcion}
                    onChange={e => setFormDescripcion(e.target.value)}
                    placeholder="Ej: Cobertura intermedia con responsabilidad civil ampliada y daño total." />
                  <p className="text-2xs text-slate-500 mt-1">
                    Una o dos líneas que resuman el alcance general. Si la dejás vacía, esta cobertura no aparece en la sección "Detalle de coberturas" del PDF.
                  </p>

                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-slate-600">
                        Qué cubre
                        <span className="ml-1 text-slate-500">(bullets que se listan en el PDF)</span>
                      </label>
                      <button onClick={() => setFormCubre(c => [...c, ''])}
                        className="btn-secondary text-2xs px-2 py-1">
                        <Plus className="h-3 w-3" /> Agregar
                      </button>
                    </div>
                    {formCubre.length === 0 ? (
                      <p className="text-xs text-slate-500 italic py-1">Sin bullets cargados — cargá al menos uno para que aparezca en el PDF.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {formCubre.map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-slate-500 text-sm">•</span>
                            <input className="form-input flex-1" value={item}
                              onChange={e => setFormCubre(arr => arr.map((x, idx) => idx === i ? e.target.value : x))}
                              placeholder="Ej: Robo total y parcial" />
                            <button onClick={() => setFormCubre(arr => arr.filter((_, idx) => idx !== i))}
                              className="h-7 w-7 flex items-center justify-center rounded text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Solo para Ramos: tipo de riesgo + editor de campos */}
              {esRamo && (
                <>
                  <div>
                    <label className="text-xs text-slate-600 mb-0.5 block font-medium">
                      Tipo de bien
                      <span className="ml-1 text-slate-500 font-normal">(qué le pide el formulario al cargar una póliza de este ramo)</span>
                    </label>
                    <select className="form-input w-full" value={formTipoRiesgo}
                      onChange={e => handleTipoRiesgoChange(e.target.value)}>
                      <option value="">— Seleccioná —</option>
                      {TIPOS_RIESGO.map(t => (
                        <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                      ))}
                    </select>
                    {formTipoRiesgo && (() => {
                      const def = obtenerTipoRiesgo(formTipoRiesgo)
                      return (
                        <div className="mt-2 bg-white border border-blue-300 rounded p-3">
                          <p className="text-2xs text-slate-600 mb-2">{def.resumen}</p>
                          <p className="text-2xs font-medium text-slate-700 mb-1">El formulario de póliza va a pedir:</p>
                          <ul className="text-2xs text-slate-600 grid grid-cols-2 gap-x-3 gap-y-0.5">
                            {def.campos_poliza.map(c => (
                              <li key={c.key} className="flex items-center gap-1">
                                <span className="text-blue-500">•</span>
                                <span>{c.label}{c.requerido && <span className="text-red-400">*</span>}</span>
                              </li>
                            ))}
                          </ul>
                          {def.ejemplos.length > 0 && def.key !== 'generico' && (
                            <p className="text-2xs text-slate-600 mt-2 italic">
                              Ramos que suelen ir acá: {def.ejemplos.join(', ')}
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Editor de campos del siniestro */}
                  <div className="border-t border-blue-200 pt-3">
                    <p className="text-xs font-medium text-slate-700 mb-0.5">Datos a pedir al cargar un siniestro de este ramo</p>
                    <p className="text-2xs text-slate-600 mb-2">Editá los campos que aparecen abajo. Estos campos solo aplican al formulario de siniestros, no al de pólizas.</p>
                    <EditorCampos campos={formCampos} onChange={setFormCampos} />
                  </div>
                </>
              )}

              {error && (
                <span className="flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="h-3 w-3" />{error}
                </span>
              )}

              <div className="flex gap-2">
                <button onClick={guardar} disabled={guardando} className="btn-primary">
                  {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={resetForm} className="btn-secondary">
                  <X className="h-3 w-3" /> Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Tabla */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            {cargandoItems ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </div>
            ) : catalogos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-500">
                <Settings className="h-8 w-8 text-slate-300" />
                <span className="text-xs">No hay elementos cargados</span>
                <button onClick={iniciarAgregado} className="btn-primary mt-1">
                  <Plus className="h-3 w-3" /> Agregar el primero
                </button>
              </div>
            ) : (
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    {esRamo && <th style={{ width: 200 }}>Tipo de bien</th>}
                    {esRamo && <th style={{ width: 130 }}>Campos del siniestro</th>}
                    {esCobertura && <th>Ramos asociados</th>}
                    {esCobertura && <th>Equivalencias</th>}
                    {esCobertura && <th style={{ width: 110 }}>Detalle PDF</th>}
                    <th style={{ width: 80 }}>Estado</th>
                    <th style={{ width: 70 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogos.map(c => (
                    <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                      <td className="font-medium text-slate-700">{c.nombre}</td>
                      {esRamo && (
                        <td className="text-xs text-slate-600">
                          {c.metadata?.tipo_riesgo
                            ? (() => {
                                const d = obtenerTipoRiesgo(c.metadata.tipo_riesgo)
                                return <span>{d.emoji} {d.label}</span>
                              })()
                            : <span className="text-amber-500">— Sin configurar</span>}
                        </td>
                      )}
                      {esRamo && (
                        <td className="text-xs text-slate-600">
                          {(c.metadata?.campos_siniestro?.length ?? 0) > 0
                            ? <span className="text-emerald-600 font-medium">{c.metadata?.campos_siniestro?.length} campos</span>
                            : <span className="text-slate-300">Sin configurar</span>
                          }
                        </td>
                      )}
                      {esCobertura && (
                        <td className="text-xs text-slate-600">
                          {(c.metadata?.ramo_ids?.length ?? 0) > 0
                            ? <span className="text-slate-600">
                                {(c.metadata?.ramo_ids as string[]).map(rid => ramosDisponibles.find(r => r.id === rid)?.nombre).filter(Boolean).join(', ') || '—'}
                              </span>
                            : <span className="text-amber-500">Sin ramos</span>
                          }
                        </td>
                      )}
                      {esCobertura && (
                        <td className="text-xs text-slate-600">
                          {(c.metadata?.equivalencias?.length ?? 0) > 0
                            ? <span className="text-slate-600">
                                {(c.metadata?.equivalencias as { compania_id: string; nombre_comercial: string }[])
                                  .map(eq => {
                                    const comp = companiasDisponibles.find(x => x.id === eq.compania_id)
                                    return comp ? `${comp.nombre}: ${eq.nombre_comercial}` : null
                                  }).filter(Boolean).join(', ') || '—'}
                              </span>
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                      )}
                      {esCobertura && (
                        <td className="text-xs text-slate-600">
                          {(() => {
                            const tieneDesc = !!(c.metadata?.descripcion && String(c.metadata.descripcion).trim())
                            const cantBullets = Array.isArray(c.metadata?.cubre)
                              ? (c.metadata.cubre as string[]).filter(s => s && String(s).trim()).length
                              : 0
                            if (!tieneDesc && cantBullets === 0) {
                              return <span className="text-slate-300">Sin cargar</span>
                            }
                            return (
                              <span className="text-emerald-600 font-medium">
                                {tieneDesc ? '✓' : '○'} desc · {cantBullets} bullets
                              </span>
                            )
                          })()}
                        </td>
                      )}
                      <td>
                        <button onClick={() => toggleActivo(c.id, c.activo, c.nombre)}
                          className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${c.activo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {c.activo ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => iniciarEdicion(c)}
                            className="btn-tabla-accion" title="Editar">
                            <Pencil />
                          </button>
                          <button onClick={() => eliminar(c.id, c.nombre)}
                            className="btn-tabla-accion-danger" title="Eliminar">
                            <Trash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
