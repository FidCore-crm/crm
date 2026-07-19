'use client'

import { usePresencia, type TipoEntidadPresencia, type ModoPresencia } from '@/lib/hooks/usePresencia'
import { Pencil } from 'lucide-react'

interface Props {
  tipoEntidad: TipoEntidadPresencia
  entidadId: string | null | undefined
  /** Modo en el que ESTE cliente se anuncia. Default 'viendo'.
   *  Los formularios de edición pasan 'editando'. */
  modo?: ModoPresencia
}

// Paleta determinística de colores para el avatar de cada usuario, basada en
// hash del user_id. Mismos colores entre sesiones para el mismo usuario.
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

const VISIBLES_MAX = 3

/**
 * Muestra avatares circulares de los otros usuarios actualmente viendo el
 * mismo recurso (persona/póliza/siniestro/etc.). Se oculta si nadie más está
 * conectado.
 *
 * Cuando alguno de los otros usuarios está en modo 'editando', se destaca con
 * ring ámbar + ícono de lápiz + banner explicativo. Ayuda a prevenir conflictos
 * antes que ocurran — el usuario ve que otro está editando y puede esperar en
 * vez de tirar un conflict al guardar.
 *
 * Usa Supabase Realtime Presence — la lista se actualiza al instante cuando
 * alguien entra o sale (incluso por cierre de pestaña).
 */
export function PresenciaEnFicha({ tipoEntidad, entidadId, modo = 'viendo' }: Props) {
  const otros = usePresencia(tipoEntidad, entidadId, modo)
  if (otros.length === 0) return null

  const editando = otros.filter((u) => u.modo === 'editando')
  const viendo = otros.filter((u) => u.modo !== 'editando')

  const visibles = otros.slice(0, VISIBLES_MAX)
  const restantes = otros.length - visibles.length
  const hayEditando = editando.length > 0

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-600">
        {hayEditando
          ? editando.length === 1
            ? '1 editando:'
            : `${editando.length} editando:`
          : 'Viendo:'}
      </span>
      <div className="flex -space-x-2">
        {visibles.map((u) => {
          const editandoEste = u.modo === 'editando'
          return (
            <div
              key={u.user_id}
              className={`relative h-7 w-7 rounded-full ${colorPara(u.user_id)} text-white text-xs font-medium flex items-center justify-center ring-2 ${
                editandoEste ? 'ring-amber-400' : 'ring-white'
              }`}
              title={`${u.nombre} ${u.apellido}${editandoEste ? ' (editando)' : ''}`}
            >
              {iniciales(u.nombre, u.apellido)}
              {editandoEste && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 ring-1 ring-white">
                  <Pencil className="h-2 w-2 text-white" />
                </span>
              )}
            </div>
          )
        })}
        {restantes > 0 && (
          <div
            className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 text-2xs font-medium flex items-center justify-center ring-2 ring-white"
            title={`+${restantes} más`}
          >
            +{restantes}
          </div>
        )}
      </div>
      {hayEditando && (
        <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-2xs font-medium text-amber-700">
          <Pencil className="h-2.5 w-2.5" />
          Otro usuario está editando
        </span>
      )}
      {/* Contador oculto para lectores de pantalla y hover completo */}
      <span className="sr-only">
        {viendo.length} viendo, {editando.length} editando
      </span>
    </div>
  )
}
