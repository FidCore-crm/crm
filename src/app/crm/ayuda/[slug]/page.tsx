'use client'

import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react'
import { ARTICULOS, obtenerArticulo } from '@/content/ayuda'

export default function ArticuloAyudaPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const articulo = slug ? obtenerArticulo(slug) : undefined
  if (!articulo) return notFound()

  const indice = ARTICULOS.findIndex((a) => a.slug === slug)
  const anterior = indice > 0 ? ARTICULOS[indice - 1] : null
  const siguiente = indice < ARTICULOS.length - 1 ? ARTICULOS[indice + 1] : null

  const Icono = articulo.icono
  const Contenido = articulo.componente

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-600">
        <Link href="/crm/ayuda" className="hover:text-blue-600 flex items-center gap-1">
          <BookOpen className="h-3 w-3" />
          Centro de Ayuda
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-700 font-medium">{articulo.titulo}</span>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 pb-3 border-b border-slate-200">
        <div className="bg-blue-50 text-blue-600 rounded-md p-2.5 shrink-0">
          <Icono className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-800">{articulo.titulo}</h1>
          <p className="text-xs text-slate-600 mt-1">{articulo.descripcion}</p>
        </div>
      </div>

      {/* Contenido del artículo */}
      <article className="ayuda-prose">
        <Contenido />
      </article>

      {/* Navegación inferior */}
      <nav className="grid grid-cols-2 gap-2 pt-4 mt-2 border-t border-slate-200">
        {anterior ? (
          <Link
            href={`/crm/ayuda/${anterior.slug}`}
            className="group flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-3 hover:border-blue-300 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-slate-500 group-hover:text-blue-500" />
            <div className="text-left min-w-0">
              <div className="text-2xs text-slate-600">Anterior</div>
              <div className="text-sm text-slate-800 truncate">{anterior.titulo}</div>
            </div>
          </Link>
        ) : (
          <div />
        )}
        {siguiente ? (
          <Link
            href={`/crm/ayuda/${siguiente.slug}`}
            className="group flex items-center justify-end gap-2 bg-white border border-slate-200 rounded-lg p-3 hover:border-blue-300 transition-colors text-right"
          >
            <div className="min-w-0">
              <div className="text-2xs text-slate-600">Siguiente</div>
              <div className="text-sm text-slate-800 truncate">{siguiente.titulo}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-blue-500" />
          </Link>
        ) : (
          <div />
        )}
      </nav>
    </div>
  )
}
