'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Search, UserCog } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { sanitizarBusquedaNormalizada } from '@/lib/utils'

interface UsuarioSimple {
  id: string
  nombre: string
  apellido: string
}

interface PersonaRow {
  id: string
  apellido: string
  nombre: string | null
  dni_cuil: string
  usuario_id: string | null
  updated_at: string | null
  _polizas_vigentes: number
  _usuario_nombre: string | null
}

export default function AsignarClientesPage() {
  const router = useRouter()
  const { isAdmin, usuario: adminActual } = useAuth()
  const supabase = getSupabaseClient()

  const [usuarios, setUsuarios] = useState<UsuarioSimple[]>([])
  const [filtroUsuario, setFiltroUsuario] = useState<string>('SIN_ASIGNAR')
  const [busqueda, setBusqueda] = useState('')
  const [personas, setPersonas] = useState<PersonaRow[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [asignarA, setAsignarA] = useState('')
  const [asignando, setAsignando] = useState(false)
  const [toast, setToast] = useState('')

  const POR_PAGINA = 25

  useEffect(() => {
    if (!isAdmin && adminActual) router.replace('/crm/dashboard')
  }, [isAdmin, adminActual, router])

  // Cargar usuarios
  useEffect(() => {
    async function cargarUsuarios() {
      const r = await apiCall<{ usuarios: Array<{ id: string; nombre: string; apellido: string; activo: boolean }> }>('/api/usuarios', {}, { mostrar_toast_en_error: false })
      if (r.ok && r.data) {
        setUsuarios(r.data.usuarios.filter(u => u.activo).map(u => ({
          id: u.id, nombre: u.nombre, apellido: u.apellido,
        })))
      }
    }
    cargarUsuarios()
  }, [])

  // Cargar personas
  const cargarPersonas = useCallback(async () => {
    setCargando(true)
    const from = (pagina - 1) * POR_PAGINA
    const to = from + POR_PAGINA - 1

    let query = supabase
      .from('personas')
      .select('id, apellido, nombre, dni_cuil, usuario_id, updated_at', { count: 'exact' })

    if (filtroUsuario === 'SIN_ASIGNAR') {
      query = query.is('usuario_id', null)
    } else {
      query = query.eq('usuario_id', filtroUsuario)
    }

    if (busqueda.trim().length >= 2) {
      const termino = sanitizarBusquedaNormalizada(busqueda)
      query = query.or(`nombre_norm.ilike.%${termino}%,apellido_norm.ilike.%${termino}%,dni_cuil.ilike.%${termino}%`)
    }

    const { data, count } = await query
      .order('apellido', { ascending: true })
      .range(from, to)

    // Contar pólizas vigentes y obtener nombre del usuario asignado
    const result: PersonaRow[] = []
    for (const p of (data ?? []) as any[]) {
      const { count: polVig } = await supabase
        .from('polizas')
        .select('id', { count: 'exact', head: true })
        .eq('asegurado_id', p.id)
        .eq('estado', 'VIGENTE')

      let usuarioNombre: string | null = null
      if (p.usuario_id) {
        const u = usuarios.find(u => u.id === p.usuario_id)
        if (u) usuarioNombre = `${u.nombre} ${u.apellido}`
      }

      result.push({
        ...p,
        _polizas_vigentes: polVig ?? 0,
        _usuario_nombre: usuarioNombre,
      })
    }

    setPersonas(result)
    setTotal(count ?? 0)
    setCargando(false)
  }, [pagina, filtroUsuario, busqueda, usuarios, supabase])

  // Volver a página 1 cuando el usuario cambia el filtro o la búsqueda.
  // Esto dispara indirectamente cargarPersonas (vía la dependencia de `pagina`
  // en el useCallback), así que no hace falta llamarlo acá.
  useEffect(() => {
    setPagina(1)
  }, [busqueda, filtroUsuario])

  // Cargar personas cuando cambia CUALQUIER dependencia de cargarPersonas
  // (pagina, filtroUsuario, busqueda, usuarios, supabase). El debounce de 350ms
  // amortigua las cadenas rápidas de cambios (tipear + cambiar filtro seguido).
  //
  // Nota: si Realtime dispara un cambio de `usuarios` mientras el PAS está en la
  // pantalla, este efecto refetchea automáticamente — el listado siempre queda
  // sincronizado.
  useEffect(() => {
    // Guard para el caso inicial: si no cargamos usuarios todavía y el filtro no
    // es SIN_ASIGNAR (que no depende de usuarios), esperamos.
    if (usuarios.length === 0 && filtroUsuario !== 'SIN_ASIGNAR') return
    const timer = setTimeout(() => cargarPersonas(), 350)
    return () => clearTimeout(timer)
  }, [cargarPersonas, usuarios.length, filtroUsuario])

  const toggleSeleccion = (id: string) => {
    setSeleccionados(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const toggleTodos = () => {
    if (seleccionados.size === personas.length) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(personas.map(p => p.id)))
    }
  }

  const asignar = async () => {
    if (!asignarA || seleccionados.size === 0) return
    setAsignando(true)

    const ids = Array.from(seleccionados)
    // Construir map { id: updated_at } para optimistic per-item. Si otro admin
    // reasignó estas mismas personas mientras teníamos la lista abierta, sus
    // updated_at cambiaron y el backend devuelve conflictos.
    const ifMatchMap: Record<string, string> = {}
    for (const p of personas) {
      if (seleccionados.has(p.id) && p.updated_at) {
        ifMatchMap[p.id] = p.updated_at
      }
    }

    const r = await apiCall<{ asignados: number; conflictos: string[]; omitidos: any[] }>(
      '/api/personas/asignar',
      {
        method: 'POST',
        body: {
          ids,
          usuario_id: asignarA === 'QUITAR' ? null : asignarA,
          if_match_map: ifMatchMap,
        },
      },
      { mostrar_toast_en_error: false },
    )

    setAsignando(false)
    if (r.ok) {
      const dest = asignarA === 'QUITAR'
        ? 'Sin asignar'
        : usuarios.find(u => u.id === asignarA)?.nombre ?? ''
      const asignados = r.data?.asignados ?? 0
      const conflictos = r.data?.conflictos ?? []
      if (conflictos.length > 0) {
        setToast(`${asignados} asignado(s) a ${dest}. ${conflictos.length} en conflicto (otro admin los cambió) — se refresca la lista.`)
        setTimeout(() => setToast(''), 6000)
      } else {
        setToast(`${asignados} cliente(s) asignado(s) a ${dest}`)
        setTimeout(() => setToast(''), 3000)
      }
      setSeleccionados(new Set())
      cargarPersonas()
    } else {
      setToast(r.error?.mensaje ?? 'No se pudo asignar')
      setTimeout(() => setToast(''), 4000)
    }
  }

  const totalPaginas = Math.ceil(total / POR_PAGINA)

  if (!isAdmin) return null

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white text-xs px-4 py-2 rounded shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => router.push('/crm/configuracion/usuarios')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
          <ArrowLeft className="h-3 w-3" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Asignar clientes a usuarios</h1>
          <p className="text-xs text-slate-600">Reasigná clientes de un usuario a otro, o asigná clientes sin usuario</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1">Usuario actual</label>
          <select
            value={filtroUsuario}
            onChange={e => { setFiltroUsuario(e.target.value); setPagina(1); setSeleccionados(new Set()) }}
            className="form-input w-full"
          >
            <option value="SIN_ASIGNAR">Sin asignar</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.apellido}, {u.nombre}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 max-w-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Nombre, apellido o DNI..."
              className="form-input w-full pl-7"
            />
          </div>
        </div>
      </div>

      {/* Barra de acción masiva */}
      {seleccionados.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded px-4 py-2">
          <span className="text-xs font-medium text-blue-700">{seleccionados.size} cliente(s) seleccionado(s)</span>
          <select value={asignarA} onChange={e => setAsignarA(e.target.value)} className="form-input text-xs">
            <option value="">Asignar a...</option>
            <option value="QUITAR">Sin asignar (quitar)</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.apellido}, {u.nombre}</option>
            ))}
          </select>
          <button
            onClick={asignar}
            disabled={!asignarA || asignando}
            className="btn-primary text-xs"
          >
            {asignando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Asignar'}
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center py-12 text-slate-500 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : personas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <UserCog className="h-6 w-6 mb-2 text-slate-300" />
            <p className="text-xs">No hay clientes con este filtro</p>
          </div>
        ) : (
          <table className="crm-table w-full">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={seleccionados.size === personas.length && personas.length > 0}
                    onChange={toggleTodos}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="text-left">Cliente</th>
                <th className="text-left">Pólizas vigentes</th>
                <th className="text-left">Usuario actual</th>
              </tr>
            </thead>
            <tbody>
              {personas.map(p => (
                <tr key={p.id} className={seleccionados.has(p.id) ? 'bg-blue-50/50' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={seleccionados.has(p.id)}
                      onChange={() => toggleSeleccion(p.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td>
                    <div className="text-xs font-medium text-slate-700">{p.apellido}{p.nombre ? `, ${p.nombre}` : ''}</div>
                    <div className="text-2xs text-slate-500 font-mono">{p.dni_cuil}</div>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-slate-600">{p._polizas_vigentes}</span>
                  </td>
                  <td>
                    {p._usuario_nombre ? (
                      <span className="text-xs text-slate-600">{p._usuario_nombre}</span>
                    ) : (
                      <span className="text-xs text-slate-500">Sin asignar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{total} cliente(s) en total</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1} className="btn-secondary px-2 py-1 text-xs disabled:opacity-40">
              Anterior
            </button>
            <span className="px-2">Página {pagina} de {totalPaginas}</span>
            <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas} className="btn-secondary px-2 py-1 text-xs disabled:opacity-40">
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
