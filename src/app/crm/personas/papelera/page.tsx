'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Trash2, RefreshCw, Loader2, AlertTriangle, Eye, Search, X,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { formatFecha, nombreCompleto } from '@/lib/utils'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { EstadoCarga } from '@/components/EstadoCarga'

interface PersonaPapelera {
  id: string
  apellido: string
  nombre: string | null
  razon_social: string | null
  dni_cuil: string
  cuil_formateado: string | null
  estado: string
  deleted_at: string
  deleted_by_usuario_id: string | null
  _eliminado_por: string | null
}

const DIAS_RETENCION = 30

function diasRestantes(deletedAt: string): number {
  const ms = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, DIAS_RETENCION - Math.floor(ms / 86400000))
}

export default function PapeleraPersonasPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [personas, setPersonas] = useState<PersonaPapelera[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)

    let query = supabase
      .from('personas')
      .select('id, apellido, nombre, razon_social, dni_cuil, cuil_formateado, estado, deleted_at, deleted_by_usuario_id, usuario_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    // Filtro de cartera
    if (usuario && !tieneAccesoTotal(usuario)) {
      query = query.eq("usuario_id", usuario.id)
    }

    const { data, error } = await query

    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudo cargar la papelera.' })
      setCargando(false)
      return
    }

    // Resolver nombre del usuario que eliminó (1 query agrupada)
    const userIds = Array.from(new Set((data ?? []).map((p: any) => p.deleted_by_usuario_id).filter(Boolean)))
    let nombresPorId: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: us } = await supabase
        .from('usuarios_perfil')
        .select('id, nombre, apellido')
        .in('id', userIds)
      for (const u of (us ?? []) as any[]) {
        nombresPorId[u.id] = [u.apellido, u.nombre].filter(Boolean).join(', ') || u.id
      }
    }

    setPersonas((data ?? []).map((p: any) => ({
      ...p,
      _eliminado_por: p.deleted_by_usuario_id ? (nombresPorId[p.deleted_by_usuario_id] ?? p.deleted_by_usuario_id) : null,
    })))
    setCargando(false)
  }, [supabase, usuario])

  useEffect(() => { cargar() }, [cargar])

  async function restaurar(id: string, nombre: string) {
    setRestaurandoId(id)
    const r = await apiCall(`/api/personas/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    setRestaurandoId(null)
    if (r.ok) {
      toast.exito(`${nombre} restaurado`)
      cargar()
    } else {
      toast.error(r.error ?? { mensaje: 'No se pudo restaurar' })
    }
  }

  const personasFiltradas = busqueda.trim()
    ? personas.filter(p => {
        const t = busqueda.trim().toLowerCase()
        const nom = nombreCompleto(p.apellido, p.nombre, p.razon_social).toLowerCase()
        return nom.includes(t) || (p.dni_cuil ?? '').includes(t)
      })
    : personas

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/crm/personas')}
            className="btn-secondary h-8 w-8 p-0 flex items-center justify-center"
            title="Volver al listado"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-amber-600" /> Papelera de clientes
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Los clientes eliminados se conservan {DIAS_RETENCION} días antes de borrarse definitivamente
            </p>
          </div>
        </div>
        <button onClick={cargar} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Aviso */}
      <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900">
          Los clientes en papelera siguen en la base de datos pero no aparecen en el listado normal ni en los buscadores.
          Pasados <strong>{DIAS_RETENCION} días</strong> se eliminan en forma definitiva con todas sus pólizas, siniestros y archivos.
          Hasta entonces se pueden restaurar desde acá o desde la propia ficha.
        </div>
      </div>

      {/* Buscador */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o DNI/CUIT..."
            className="search-input w-full pl-6"
          />
        </div>
        {busqueda && (
          <button onClick={() => setBusqueda('')} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50">
          <span className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">{personasFiltradas.length}</span>{' '}
            cliente{personasFiltradas.length !== 1 ? 's' : ''} en papelera
          </span>
        </div>
        <div className="overflow-x-auto">
          <EstadoCarga
            loading={cargando}
            error={errorCarga}
            empty={!cargando && !errorCarga && personasFiltradas.length === 0}
            emptyIcono={<Trash2 className="h-8 w-8 text-slate-300 mb-3" />}
            emptyMensaje={busqueda ? 'No hay clientes en papelera con esos criterios' : 'La papelera está vacía'}
            onReintentar={cargar}
          >
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Apellido y Nombre</th>
                  <th style={{ width: 130 }}>DNI / CUIT</th>
                  <th style={{ width: 130 }}>Eliminado</th>
                  <th style={{ width: 160 }}>Eliminado por</th>
                  <th style={{ width: 130 }}>Días restantes</th>
                  <th style={{ width: 130 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {personasFiltradas.map((p) => {
                  const dias = diasRestantes(p.deleted_at)
                  const nombre = nombreCompleto(p.apellido, p.nombre, p.razon_social)
                  const colorDias = dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-600' : 'text-slate-600'
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="font-medium text-slate-800 text-sm">{nombre}</span>
                      </td>
                      <td>
                        <span className="font-mono text-xs text-slate-600">
                          {p.cuil_formateado ?? p.dni_cuil}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600 font-mono">{formatFecha(p.deleted_at)}</span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">
                          {p._eliminado_por ?? <span className="text-slate-300">—</span>}
                        </span>
                      </td>
                      <td>
                        <span className={`text-xs font-medium ${colorDias}`}>
                          {dias} día{dias !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => router.push(`/crm/personas/${p.id}`)}
                            className="btn-tabla-accion"
                            title="Ver ficha"
                          >
                            <Eye />
                          </button>
                          <button
                            onClick={() => restaurar(p.id, nombre)}
                            disabled={restaurandoId === p.id}
                            className="btn-tabla-accion-success"
                            title="Restaurar"
                          >
                            {restaurandoId === p.id
                              ? <Loader2 className="animate-spin" />
                              : <RefreshCw />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </EstadoCarga>
        </div>
      </div>
    </div>
  )
}
