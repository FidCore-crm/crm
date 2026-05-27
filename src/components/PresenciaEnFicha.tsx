'use client'

import { usePresencia, type TipoEntidadPresencia } from '@/lib/hooks/usePresencia'

interface Props {
  tipoEntidad: TipoEntidadPresencia
  entidadId: string | null | undefined
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
 * Usa Supabase Realtime Presence — la lista se actualiza al instante cuando
 * alguien entra o sale (incluso por cierre de pestaña).
 */
export function PresenciaEnFicha({ tipoEntidad, entidadId }: Props) {
  const otros = usePresencia(tipoEntidad, entidadId)
  if (otros.length === 0) return null

  const visibles = otros.slice(0, VISIBLES_MAX)
  const restantes = otros.length - visibles.length

  return (
    <div
      className="flex items-center gap-2"
      title={`${otros.length} ${otros.length === 1 ? 'persona' : 'personas'} viendo esta ficha`}
    >
      <span className="text-xs text-slate-500">Viendo:</span>
      <div className="flex -space-x-2">
        {visibles.map((u) => (
          <div
            key={u.user_id}
            className={`h-7 w-7 rounded-full ${colorPara(u.user_id)} text-white text-xs font-medium flex items-center justify-center ring-2 ring-white`}
            title={`${u.nombre} ${u.apellido}`}
          >
            {iniciales(u.nombre, u.apellido)}
          </div>
        ))}
        {restantes > 0 && (
          <div
            className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 text-2xs font-medium flex items-center justify-center ring-2 ring-white"
            title={`+${restantes} más`}
          >
            +{restantes}
          </div>
        )}
      </div>
    </div>
  )
}
