'use client'

/**
 * Combobox searchable de personas con búsqueda server-side.
 *
 * Reemplaza el <select> con `.limit(300)` que rompía cuando un PAS tenía
 * más clientes que ese tope. El usuario tipea, debounce 300ms, y la query
 * va a Supabase con `.ilike` sobre apellido/nombre/dni_cuil/razon_social.
 *
 * Respeta el filtro de cartera (PROPIA solo ve sus personas + null).
 *
 * Uso:
 *   <BuscadorPersona value={persona_id} onChange={(id, persona) => ...} />
 */

import { useEffect, useRef, useState, useCallback, useId } from 'react'
import { Search, X, Loader2, Check } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { sanitizarBusquedaNormalizada } from '@/lib/utils'

interface PersonaResult {
  id: string
  apellido: string
  nombre: string | null
  razon_social: string | null
  dni_cuil: string | null
}

interface Props {
  value: string
  onChange: (id: string, persona?: PersonaResult) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  /** Mostrar borde rojo (validación inline) */
  invalido?: boolean
  /** Auto-focus al montar */
  autoFocus?: boolean
}

function nombreDe(p: PersonaResult): string {
  if (p.razon_social) return p.razon_social
  return [p.apellido, p.nombre].filter(Boolean).join(', ')
}

const LIMITE_RESULTADOS = 30

export default function BuscadorPersona({
  value,
  onChange,
  className = '',
  placeholder = 'Buscar por apellido, DNI/CUIT o razón social...',
  disabled = false,
  invalido = false,
  autoFocus = false,
}: Props) {
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [seleccionada, setSeleccionada] = useState<PersonaResult | null>(null)
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState<PersonaResult[]>([])
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastValueRef = useRef<string>('')
  const buscarAbortRef = useRef<AbortController | null>(null)

  // IDs únicos para vincular el combobox con el listbox (ARIA).
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (i: number) => `${baseId}-option-${i}`

  // Cargar persona inicial cuando llega un value
  useEffect(() => {
    if (!value) {
      setSeleccionada(null)
      lastValueRef.current = ''
      return
    }
    if (value === lastValueRef.current && seleccionada?.id === value) return

    let cancelado = false
    const cargarSel = async () => {
      let q = supabase
        .from('personas')
        .select('id, apellido, nombre, razon_social, dni_cuil')
        .eq('id', value)
        .is('deleted_at', null)
      // Respetar filtro de cartera: si la persona es ajena, no la mostramos.
      if (usuario && !tieneAccesoTotal(usuario)) {
        q = q.eq("usuario_id", usuario.id)
      }
      const { data } = await q.maybeSingle()
      if (cancelado) return
      if (data) {
        setSeleccionada(data as PersonaResult)
        lastValueRef.current = value
      } else {
        // Persona inexistente o fuera de cartera: limpiar value para no aceptar guardado.
        setSeleccionada(null)
        lastValueRef.current = ''
        onChange('')
      }
    }
    cargarSel()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, supabase, usuario])

  // Cierre por click afuera
  useEffect(() => {
    if (!abierto) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [abierto])

  const buscar = useCallback(async (term: string) => {
    setCargando(true)

    // Cancelar la búsqueda en vuelo si la había.
    buscarAbortRef.current?.abort()
    const controller = new AbortController()
    buscarAbortRef.current = controller

    let q = supabase
      .from('personas')
      .select('id, apellido, nombre, razon_social, dni_cuil')
      .is('deleted_at', null)
      .order('apellido')
      .limit(LIMITE_RESULTADOS)
      .abortSignal(controller.signal)

    if (usuario && !tieneAccesoTotal(usuario)) {
      q = q.eq("usuario_id", usuario.id)
    }

    if (term.trim()) {
      const safe = sanitizarBusquedaNormalizada(term)
      q = q.or(`apellido_norm.ilike.%${safe}%,nombre_norm.ilike.%${safe}%,dni_cuil.ilike.%${safe}%,razon_social_norm.ilike.%${safe}%`)
    }

    const { data, error } = await q
    if (controller.signal.aborted) return
    if (!error) {
      setResultados((data ?? []) as PersonaResult[])
      setHighlight(0)
    }
    setCargando(false)
  }, [supabase, usuario])

  // Debounce de la búsqueda
  useEffect(() => {
    if (!abierto) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => buscar(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, abierto, buscar])

  const elegir = (p: PersonaResult) => {
    setSeleccionada(p)
    lastValueRef.current = p.id
    setAbierto(false)
    setQuery('')
    onChange(p.id, p)
  }

  const limpiar = () => {
    setSeleccionada(null)
    lastValueRef.current = ''
    setQuery('')
    onChange('')
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!abierto) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, resultados.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (resultados[highlight]) elegir(resultados[highlight])
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  const baseInput = `form-input w-full ${invalido ? 'border-red-400 ring-red-100' : ''}`

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {seleccionada ? (
        <div className={`flex items-center gap-2 px-2.5 h-8 rounded border ${invalido ? 'border-red-400' : 'border-slate-200'} bg-white text-sm`}>
          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span className="flex-1 truncate text-slate-700">
            {nombreDe(seleccionada)}
            {seleccionada.dni_cuil && (
              <span className="text-2xs text-slate-400 ml-2 font-mono">{seleccionada.dni_cuil}</span>
            )}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={limpiar}
              className="text-slate-400 hover:text-slate-600 shrink-0"
              aria-label="Limpiar selección"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={abierto}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              abierto && resultados[highlight] ? optionId(highlight) : undefined
            }
            aria-invalid={invalido || undefined}
            className={`${baseInput} pl-8`}
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={e => { setQuery(e.target.value); setAbierto(true) }}
            onFocus={() => setAbierto(true)}
            onKeyDown={onKey}
          />
          {cargando && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 animate-spin" />
          )}
        </div>
      )}

      {abierto && !seleccionada && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Resultados de personas"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg"
        >
          {resultados.length === 0 && !cargando && (
            <div className="p-3 text-xs text-slate-400 text-center">
              {query.trim() ? 'Sin resultados' : 'Empezá a tipear para buscar'}
            </div>
          )}
          {resultados.map((p, i) => (
            <button
              type="button"
              key={p.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === highlight}
              onClick={() => elegir(p)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 ${i === highlight ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            >
              <span className="truncate text-slate-700">{nombreDe(p)}</span>
              {p.dni_cuil && (
                <span className="text-2xs text-slate-400 font-mono shrink-0">{p.dni_cuil}</span>
              )}
            </button>
          ))}
          {resultados.length === LIMITE_RESULTADOS && (
            <div className="px-3 py-1.5 text-2xs text-slate-400 text-center bg-slate-50 border-t border-slate-100">
              Mostrando primeros {LIMITE_RESULTADOS} — refiná la búsqueda para más
            </div>
          )}
        </div>
      )}
    </div>
  )
}
