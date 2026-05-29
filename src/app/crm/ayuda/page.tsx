'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ChevronRight, BookOpen, Search, HelpCircle, Loader2 } from 'lucide-react'
import { ARTICULOS } from '@/content/ayuda'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

export default function CentroAyudaPage() {
  const { usuario, refetch } = useAuth()
  const [busqueda, setBusqueda] = useState('')
  const [guardandoPref, setGuardandoPref] = useState(false)

  const articulosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return ARTICULOS
    return ARTICULOS.filter(
      (a) =>
        a.titulo.toLowerCase().includes(q) ||
        a.descripcion.toLowerCase().includes(q),
    )
  }, [busqueda])

  async function toggleTooltips() {
    if (!usuario || guardandoPref) return
    setGuardandoPref(true)
    const nuevo = !usuario.mostrar_ayuda_contextual
    const res = await apiCall('/api/usuarios/me/preferencias', {
      method: 'PATCH',
      body: { mostrar_ayuda_contextual: nuevo },
    })
    if (res.ok) {
      await refetch()
      toast.exito(nuevo ? 'Ayuda contextual activada' : 'Ayuda contextual desactivada')
    }
    setGuardandoPref(false)
  }

  const tooltipsActivos = usuario?.mostrar_ayuda_contextual !== false

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-slate-700" />
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Centro de Ayuda</h1>
          <p className="text-xs text-slate-500">
            Guías cortas para entender cada módulo del CRM.
          </p>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="relative max-w-md">
        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por tema..."
          className="form-input pl-8"
        />
      </div>

      {/* Grid de artículos */}
      {articulosFiltrados.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-10 text-center">
          <p className="text-sm text-slate-500">No encontramos artículos para esa búsqueda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {articulosFiltrados.map((a) => {
            const Icono = a.icono
            return (
              <Link
                key={a.slug}
                href={`/crm/ayuda/${a.slug}`}
                className="group bg-white border border-slate-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="bg-blue-50 text-blue-600 rounded-md p-2 shrink-0">
                    <Icono className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                      {a.titulo}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {a.descripcion}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-500 shrink-0 self-center" />
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Tip + toggle de ayuda contextual */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5 flex items-start gap-3">
        <HelpCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs text-blue-900">
            Además de estos artículos, vas a ver íconos{' '}
            <span className="inline-flex items-center justify-center bg-white text-slate-400 rounded-full h-4 w-4 border border-slate-300 text-2xs">?</span>{' '}
            al lado de campos y botones específicos dentro del CRM. Hacé clic ahí para una explicación corta sin salir del flujo.
          </p>
          <p className="text-2xs text-blue-700 mt-1.5">
            {tooltipsActivos
              ? 'Cuando ya no los necesites, podés desactivarlos acá. Esta página y los artículos siguen accesibles siempre.'
              : 'Los íconos de ayuda están desactivados. Reactivalos cuando quieras.'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTooltips}
          disabled={guardandoPref || !usuario}
          className={`shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-50 ${
            tooltipsActivos
              ? 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {guardandoPref && <Loader2 className="h-3 w-3 animate-spin" />}
          {tooltipsActivos ? 'Desactivar ayuda contextual' : 'Activar ayuda contextual'}
        </button>
      </div>
    </div>
  )
}
