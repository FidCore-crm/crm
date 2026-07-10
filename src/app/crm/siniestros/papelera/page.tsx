'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Trash2, RefreshCw, Loader2, AlertTriangle, Eye, Search, X,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas } from '@/lib/cartera-filter'
import { formatFecha } from '@/lib/utils'
import { getEstadoBadge } from '@/lib/siniestros-config'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface SiniestroPapelera {
  id: string
  numero_caso: string
  numero_siniestro: string | null
  estado: string
  fecha_denuncia: string
  deleted_at: string
  deleted_by_usuario_id: string | null
  asegurado: { id: string; apellido: string; nombre: string; razon_social: string | null } | null
  _eliminado_por: string | null
}

const DIAS_RETENCION = 30

function diasRestantes(deletedAt: string): number {
  const ms = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, DIAS_RETENCION - Math.floor(ms / 86400000))
}

function nombrePersona(s: SiniestroPapelera): string {
  if (!s.asegurado) return '—'
  return [s.asegurado.apellido, s.asegurado.nombre].filter(Boolean).join(', ') || s.asegurado.razon_social || '—'
}

export default function PapeleraSiniestrosPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [siniestros, setSiniestros] = useState<SiniestroPapelera[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)

    const idsPersonas = await obtenerIdsPersonas(supabase, usuario)

    let query = supabase
      .from('siniestros')
      .select(`
        id, numero_caso, numero_siniestro, estado, fecha_denuncia,
        deleted_at, deleted_by_usuario_id,
        asegurado:personas!persona_id (id, apellido, nombre, razon_social)
      `)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    query = filtrarPorPersonas(query, idsPersonas, 'persona_id')

    const { data, error } = await query

    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudo cargar la papelera.' })
      setCargando(false)
      return
    }

    // Resolver nombre del usuario que eliminó
    const userIds = Array.from(new Set((data ?? []).map((s: any) => s.deleted_by_usuario_id).filter(Boolean)))
    const nombresPorId: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: us } = await supabase
        .from('usuarios_perfil')
        .select('id, nombre, apellido')
        .in('id', userIds)
      for (const u of (us ?? []) as any[]) {
        nombresPorId[u.id] = [u.apellido, u.nombre].filter(Boolean).join(', ') || u.id
      }
    }

    setSiniestros((data ?? []).map((s: any) => ({
      ...s,
      _eliminado_por: s.deleted_by_usuario_id ? (nombresPorId[s.deleted_by_usuario_id] ?? s.deleted_by_usuario_id) : null,
    })) as unknown as SiniestroPapelera[])
    setCargando(false)
  }, [supabase, usuario])

  useEffect(() => { cargar() }, [cargar])

  useRealtimeRefresh({ tablas: ['siniestros'], onCambio: cargar })

  async function restaurar(id: string, numeroCaso: string) {
    setRestaurandoId(id)
    const r = await apiCall(`/api/siniestros/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    setRestaurandoId(null)
    if (r.ok) {
      toast.exito(`Caso #${numeroCaso} restaurado`)
      cargar()
    } else {
      toast.error(r.error ?? { mensaje: 'No se pudo restaurar' })
    }
  }

  const siniestrosFiltrados = busqueda.trim()
    ? siniestros.filter(s => {
        const t = busqueda.trim().toLowerCase()
        return (
          (s.numero_caso ?? '').toLowerCase().includes(t) ||
          (s.numero_siniestro ?? '').toLowerCase().includes(t) ||
          nombrePersona(s).toLowerCase().includes(t)
        )
      })
    : siniestros

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/crm/siniestros')}
            className="btn-secondary h-8 w-8 p-0 flex items-center justify-center"
            title="Volver al listado"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-amber-600" /> Papelera de siniestros
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Los siniestros eliminados se conservan {DIAS_RETENCION} días antes de borrarse definitivamente
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
          Los siniestros en papelera siguen en la base de datos pero no aparecen en el listado normal ni en los KPIs.
          Pasados <strong>{DIAS_RETENCION} días</strong> se eliminan en forma definitiva con bitácora y archivos.
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
            placeholder="Buscar por nro. caso, nro. siniestro o cliente..."
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
            <span className="font-medium text-slate-700">{siniestrosFiltrados.length}</span>{' '}
            siniestro{siniestrosFiltrados.length !== 1 ? 's' : ''} en papelera
          </span>
        </div>
        <div className="overflow-x-auto">
          <EstadoCarga
            loading={cargando}
            error={errorCarga}
            empty={!cargando && !errorCarga && siniestrosFiltrados.length === 0}
            emptyIcono={<Trash2 className="h-8 w-8 text-slate-300 mb-3" />}
            emptyMensaje={busqueda ? 'No hay siniestros en papelera con esos criterios' : 'La papelera está vacía'}
            onReintentar={cargar}
          >
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Siniestro N°</th>
                  <th>Cliente</th>
                  <th>Estado al eliminar</th>
                  <th>Eliminado</th>
                  <th>Eliminado por</th>
                  <th>Días restantes</th>
                  <th style={{ width: 130 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {siniestrosFiltrados.map((s) => {
                  const dias = diasRestantes(s.deleted_at)
                  const colorDias = dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-600' : 'text-slate-600'
                  const badge = getEstadoBadge(s.estado)
                  return (
                    <tr key={s.id}>
                      <td className="font-mono text-xs font-semibold text-slate-700">{s.numero_caso}</td>
                      <td className="font-mono text-xs text-slate-500">{s.numero_siniestro ?? '—'}</td>
                      <td className="text-xs text-slate-700">{nombrePersona(s)}</td>
                      <td>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600 font-mono">{formatFecha(s.deleted_at)}</span>
                      </td>
                      <td className="text-xs text-slate-600">
                        {s._eliminado_por ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td>
                        <span className={`text-xs font-medium ${colorDias}`}>
                          {dias} día{dias !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => router.push(`/crm/siniestros/${s.id}`)}
                            className="btn-tabla-accion"
                            title="Ver ficha"
                          >
                            <Eye />
                          </button>
                          <button
                            onClick={() => restaurar(s.id, s.numero_caso)}
                            disabled={restaurandoId === s.id}
                            className="btn-tabla-accion-success"
                            title="Restaurar"
                          >
                            {restaurandoId === s.id
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
