'use client'

import { useState, useRef, useEffect } from 'react'
import { usePresenciaGlobal } from '@/lib/hooks/usePresenciaGlobal'
import { useAuth } from '@/contexts/AuthContext'
import { Users, X } from 'lucide-react'

/**
 * Botón en la navbar (al lado de la campana de notificaciones) que muestra
 * cantidad de usuarios conectados. Click abre dropdown con la lista completa.
 *
 * Solo visible para admin. Se oculta si solo está el propio usuario
 * (nada interesante para ver con 1).
 */

const COLORES = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-rose-500',
  'bg-teal-500',
]

function colorPara(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return COLORES[Math.abs(hash) % COLORES.length]
}

function iniciales(nombre: string, apellido: string): string {
  return `${(nombre[0] ?? '').toUpperCase()}${(apellido[0] ?? '').toUpperCase()}`
}

export function PresenciaNavbar() {
  const { isAdmin, usuario } = useAuth()
  const conectados = usePresenciaGlobal()
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Click fuera cierra
  useEffect(() => {
    if (!abierto) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [abierto])

  if (!isAdmin) return null
  if (conectados.length <= 1) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="relative flex h-7 items-center gap-1 px-2 rounded
                   text-slate-600 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        title="Usuarios conectados al CRM"
        aria-expanded={abierto}
      >
        <Users className="h-4 w-4" />
        <span className="text-xs font-semibold tabular-nums">{conectados.length}</span>
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
      </button>

      {abierto && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-50 flex flex-col max-h-[500px]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-700">
              Conectados ahora ({conectados.length})
            </span>
            <button
              onClick={() => setAbierto(false)}
              className="text-slate-500 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ul className="flex flex-col overflow-y-auto py-1">
            {conectados.map((u) => {
              const esYo = u.user_id === usuario?.id
              return (
                <li
                  key={u.user_id}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  title={`${u.nombre} ${u.apellido}${esYo ? ' (vos)' : ''}`}
                >
                  <div className="relative flex-shrink-0">
                    <div
                      className={`h-7 w-7 rounded-full ${colorPara(u.user_id)} text-white text-2xs font-medium flex items-center justify-center`}
                    >
                      {iniciales(u.nombre, u.apellido)}
                    </div>
                    {/* Punto verde de online */}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">
                      {u.nombre} {u.apellido}
                      {esYo && <span className="text-slate-500 ml-1 font-normal">(vos)</span>}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
