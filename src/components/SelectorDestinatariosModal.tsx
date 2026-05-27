'use client'

/**
 * Modal para elegir uno o varios destinatarios de un envío de email. Se usa
 * desde la pantalla central de comunicaciones, donde el PAS no parte de una
 * ficha concreta (a diferencia del flujo de ficha de persona/póliza).
 *
 * Flujo:
 *   1) Tab "Cliente individual": search + lista — al elegir uno, llama
 *      onElegirIndividual(persona) y cierra. El caller se encarga de abrir
 *      luego el ModalEnviarEmail para esa persona.
 *   2) Tab "Varios clientes": filtros + checkboxes — al confirmar, llama
 *      onElegirMasivo(personas[]) y cierra. El caller abre ModalEnviarEmailMasivo.
 *
 * Respeta filtro de cartera: solo lista personas accesibles para el usuario.
 */

import { useEffect, useMemo, useState } from 'react'
import { X, Search, User, Users, Mail, Filter, Loader2, CheckCircle2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  obtenerIdsPersonas,
  filtrarPorPersonas,
} from '@/lib/cartera-filter'
import { sanitizarBusquedaNormalizada } from '@/lib/utils'

interface PersonaItem {
  id: string
  nombre: string | null
  apellido: string
  razon_social: string | null
  email: string | null
  acepta_marketing: boolean
  estado: string
}

interface Props {
  abierto: boolean
  onClose: () => void
  onElegirIndividual: (persona: PersonaItem) => void
  onElegirMasivo: (personas: PersonaItem[]) => void
}

function nombre(p: PersonaItem): string {
  return [p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'
}

export default function SelectorDestinatariosModal({
  abierto,
  onClose,
  onElegirIndividual,
  onElegirMasivo,
}: Props) {
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const [tab, setTab] = useState<'individual' | 'masivo'>('individual')

  // Compartido
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [cargando, setCargando] = useState(false)
  const [personas, setPersonas] = useState<PersonaItem[]>([])
  const [filtroEstado, setFiltroEstado] = useState('ACTIVO')

  // Masivo
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounce(busqueda), 350)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!abierto) return
    setSeleccionados(new Set())
  }, [abierto, tab])

  // Cerrar con Esc
  useEffect(() => {
    if (!abierto) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [abierto, onClose])

  // Cargar personas según el tab + filtros
  useEffect(() => {
    if (!abierto || !usuario) return
    let cancelado = false
    setCargando(true)

    ;(async () => {
      const ids = await obtenerIdsPersonas(supabase, usuario)
      let q = supabase
        .from('personas')
        .select('id, nombre, apellido, razon_social, email, acepta_marketing, estado')
        .is('deleted_at', null)
        .order('apellido', { ascending: true })
        .limit(tab === 'individual' ? 30 : 200)

      q = filtrarPorPersonas(q, ids, 'id')

      // En masivo el filtro de estado es relevante
      if (tab === 'masivo' && filtroEstado) {
        q = q.eq('estado', filtroEstado)
      }

      if (busquedaDebounce) {
        const safe = sanitizarBusquedaNormalizada(busquedaDebounce)
        q = q.or(
          `apellido_norm.ilike.%${safe}%,nombre_norm.ilike.%${safe}%,razon_social_norm.ilike.%${safe}%,dni_cuil.ilike.%${safe}%,email.ilike.%${safe}%`,
        )
      }

      const { data } = await q
      if (cancelado) return
      setPersonas((data as any[]) || [])
      setCargando(false)
    })()

    return () => { cancelado = true }
  }, [abierto, usuario, tab, busquedaDebounce, filtroEstado, supabase])

  // Análisis de los seleccionados (para el banner del masivo)
  const analisis = useMemo(() => {
    const sel = personas.filter(p => seleccionados.has(p.id))
    const validos = sel.filter(p => p.email && p.acepta_marketing !== false).length
    const sinEmail = sel.filter(p => !p.email).length
    const noMarketing = sel.filter(p => p.email && p.acepta_marketing === false).length
    return { total: sel.length, validos, sinEmail, noMarketing }
  }, [personas, seleccionados])

  if (!abierto) return null

  function togglePersona(id: string) {
    setSeleccionados(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (seleccionados.size === personas.length) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(personas.map(p => p.id)))
    }
  }

  function confirmarMasivo() {
    const elegidos = personas.filter(p => seleccionados.has(p.id))
    onElegirMasivo(elegidos)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">Nuevo envío de email</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <button
            onClick={() => setTab('individual')}
            className={`flex-1 px-4 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'individual'
                ? 'bg-white text-blue-700 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <User className="h-3.5 w-3.5" /> A un cliente puntual
          </button>
          <button
            onClick={() => setTab('masivo')}
            className={`flex-1 px-4 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'masivo'
                ? 'bg-white text-blue-700 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="h-3.5 w-3.5" /> A varios clientes
          </button>
        </div>

        {/* Filtros */}
        <div className="px-4 py-3 border-b border-slate-100 bg-white flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              className="search-input w-full pl-7"
              placeholder={tab === 'individual' ? 'Buscar cliente por nombre, DNI o email…' : 'Filtrar lista por nombre o email…'}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoFocus
            />
          </div>
          {tab === 'masivo' && (
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="form-input"
              aria-label="Filtrar por estado"
            >
              <option value="">Todos los estados</option>
              <option value="ACTIVO">Activos</option>
              <option value="PROSPECTO">Prospectos</option>
              <option value="INACTIVO">Inactivos</option>
            </select>
          )}
        </div>

        {/* Listado */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[280px]">
          {cargando ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-400 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : personas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-slate-400 gap-2">
              <Filter className="h-5 w-5" />
              <span>No hay personas con esos filtros.</span>
            </div>
          ) : tab === 'individual' ? (
            <ul className="space-y-1">
              {personas.map(p => {
                const tieneEmail = !!p.email
                return (
                  <li key={p.id}>
                    <button
                      disabled={!tieneEmail}
                      onClick={() => tieneEmail && onElegirIndividual(p)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded text-left text-xs transition-colors ${
                        tieneEmail
                          ? 'hover:bg-blue-50 cursor-pointer'
                          : 'opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-slate-700">{nombre(p)}</div>
                        <div className="text-2xs text-slate-500">
                          {p.email || <span className="italic text-amber-600">Sin email cargado</span>}
                        </div>
                      </div>
                      {tieneEmail && p.acepta_marketing === false && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                          Opt-out
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div>
              <div className="flex items-center justify-between px-2 py-1 text-2xs text-slate-500 border-b border-slate-100 mb-1">
                <button onClick={toggleAll} className="hover:text-slate-700">
                  {seleccionados.size === personas.length ? 'Desmarcar todos' : 'Seleccionar todos'}
                </button>
                <span>{seleccionados.size} de {personas.length} seleccionados</span>
              </div>
              <ul className="space-y-0.5">
                {personas.map(p => {
                  const sel = seleccionados.has(p.id)
                  return (
                    <li key={p.id}>
                      <label
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                          sel ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => togglePersona(p.id)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-700 truncate">{nombre(p)}</div>
                          <div className="text-2xs text-slate-500 truncate">
                            {p.email || <span className="italic text-amber-600">Sin email</span>}
                          </div>
                        </div>
                        {p.acepta_marketing === false && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                            Opt-out
                          </span>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer masivo */}
        {tab === 'masivo' && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="text-2xs text-slate-600">
              {analisis.total === 0 ? (
                <span>Tildá los clientes a los que querés mandar el email.</span>
              ) : (
                <span>
                  <strong className="text-slate-800">{analisis.validos}</strong> recibirán el email
                  {analisis.sinEmail > 0 && <span className="text-amber-700"> · {analisis.sinEmail} sin email</span>}
                  {analisis.noMarketing > 0 && <span className="text-amber-700"> · {analisis.noMarketing} opt-out</span>}
                </span>
              )}
            </div>
            <button
              onClick={confirmarMasivo}
              disabled={analisis.total === 0}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Continuar con {analisis.total}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
