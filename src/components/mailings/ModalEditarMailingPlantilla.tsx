'use client'

/**
 * Modal de alta/edición de una mailing_plantilla.
 *
 * Estructura:
 *   - Nombre (interno, no aparece en el email)
 *   - Descripción (interno)
 *   - Asunto del email
 *   - Saludo (ej: "Hola {{nombre}}!")
 *   - Cuerpo (texto principal con variables)
 *   - Cierre (despedida)
 *   - CTA opcional (texto + URL → botón al final del email)
 *
 * Variables disponibles: chips clickeables que se insertan en el campo activo.
 */

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Save, Eye, Image as ImageIcon } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import type { MailingPlantilla } from './TabMailingPlantillas'
import SelectorImagenBiblioteca, { type ArchivoBiblioteca } from '@/components/biblioteca/SelectorImagenBiblioteca'

interface Props {
  plantilla: MailingPlantilla | null  // null = creando nueva
  onCerrar: () => void
  onGuardada: () => void
}

const VARIABLES_BASE = [
  '{{nombre}}', '{{nombre_completo}}', '{{apellido}}', '{{email}}', '{{telefono}}',
  '{{organizacion_nombre}}', '{{organizacion_telefono}}', '{{organizacion_email}}',
  '{{titulo}}', '{{cuerpo_mensaje}}',
]

const ASUNTO_DEFAULT = ''
const SALUDO_DEFAULT = 'Hola {{nombre}}!'
const CUERPO_DEFAULT = ''
const CIERRE_DEFAULT = 'Saludos,\n{{organizacion_nombre}}'

export default function ModalEditarMailingPlantilla({ plantilla, onCerrar, onGuardada }: Props) {
  const esNueva = plantilla === null
  const [nombre, setNombre] = useState(plantilla?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(plantilla?.descripcion ?? '')
  const [asunto, setAsunto] = useState(plantilla?.asunto ?? ASUNTO_DEFAULT)
  const [saludo, setSaludo] = useState(plantilla?.saludo ?? SALUDO_DEFAULT)
  const [cuerpo, setCuerpo] = useState(plantilla?.cuerpo ?? CUERPO_DEFAULT)
  const [cierre, setCierre] = useState(plantilla?.cierre ?? CIERRE_DEFAULT)
  const [ctaTexto, setCtaTexto] = useState(plantilla?.cta_texto ?? '')
  const [ctaUrl, setCtaUrl] = useState(plantilla?.cta_url ?? '')

  const [guardando, setGuardando] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewAbierto, setPreviewAbierto] = useState(false)
  const [previewCargando, setPreviewCargando] = useState(false)

  const focusedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const cuerpoRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectorImagenAbierto, setSelectorImagenAbierto] = useState(false)

  function insertarImagenEnCuerpo(archivo: ArchivoBiblioteca) {
    const marcador = `[[IMG:${archivo.id}]]`
    const ta = cuerpoRef.current
    if (!ta) {
      setCuerpo(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${marcador}\n`)
      setSelectorImagenAbierto(false)
      return
    }
    const inicio = ta.selectionStart ?? cuerpo.length
    const fin = ta.selectionEnd ?? cuerpo.length
    const nuevo = cuerpo.substring(0, inicio) + marcador + cuerpo.substring(fin)
    setCuerpo(nuevo)
    setSelectorImagenAbierto(false)
    setTimeout(() => {
      ta.focus()
      const pos = inicio + marcador.length
      ta.setSelectionRange(pos, pos)
    }, 0)
  }

  // Preview en vivo (debounced). actualizarPreview usa los mismos state values
  // del array de deps; declararla explícitamente sería redundante.
  useEffect(() => {
    if (!previewAbierto) return
    const t = setTimeout(() => actualizarPreview(), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asunto, saludo, cuerpo, cierre, ctaTexto, ctaUrl, previewAbierto])

  async function actualizarPreview() {
    setPreviewCargando(true)
    // Usamos el preview-draft que ya existe (acepta cualquier código de plantilla
    // y los textos vía body). Pasamos un código dummy.
    const r = await apiCall<{ html: string }>(
      '/api/configuracion/comunicaciones/plantillas/notificacion_general/preview-draft',
      {
        method: 'POST',
        body: {
          asunto,
          saludo,
          cuerpo,
          cierre,
          // El endpoint genera el HTML real del botón desde cta_texto/cta_url
          // e inyecta {{boton_accion}} en el cuerpo si no está ya (v1.0.142).
          cta_texto: ctaTexto.trim() || undefined,
          cta_url: ctaUrl.trim() || undefined,
          variables: { titulo: asunto, cuerpo_mensaje: cuerpo },
        },
      },
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setPreviewHtml(r.data.html)
    setPreviewCargando(false)
  }

  function insertarVariable(v: string) {
    const el = focusedRef.current
    if (!el) {
      // Default: pega al final del cuerpo
      setCuerpo(c => c + ' ' + v)
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const nuevo = el.value.slice(0, start) + v + el.value.slice(end)
    if (el === document.activeElement) {
      // Actualizar el estado correcto según qué input está activo
      const name = (el as HTMLInputElement | HTMLTextAreaElement).name
      if (name === 'asunto') setAsunto(nuevo)
      else if (name === 'saludo') setSaludo(nuevo)
      else if (name === 'cuerpo') setCuerpo(nuevo)
      else if (name === 'cierre') setCierre(nuevo)
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + v.length, start + v.length)
      }, 0)
    }
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast.error('Falta el nombre de la plantilla')
      return
    }
    if (!asunto.trim() || !cuerpo.trim()) {
      toast.error('Asunto y cuerpo son obligatorios')
      return
    }
    setGuardando(true)
    const body = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      asunto: asunto.trim(),
      saludo,
      cuerpo,
      cierre,
      cta_texto: ctaTexto.trim() || null,
      cta_url: ctaUrl.trim() || null,
    }
    const r = esNueva
      ? await apiCall('/api/comunicaciones/mailing-plantillas', { method: 'POST', body })
      : await apiCall(`/api/comunicaciones/mailing-plantillas/${plantilla.id}`, { method: 'PATCH', body })
    setGuardando(false)
    if (r.ok) {
      toast.exito(esNueva ? 'Plantilla creada' : 'Plantilla actualizada')
      onGuardada()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">
            {esNueva ? 'Nueva plantilla' : `Editar: ${plantilla.nombre}`}
          </h3>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body scroll */}
        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-3">
          {/* Nombre + descripción (interno) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">
                Nombre (interno) *
              </label>
              <input
                type="text"
                name="nombre"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Promoción fin de año"
                className="form-input w-full text-sm"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">
                Descripción (opcional)
              </label>
              <input
                type="text"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Para qué la vamos a usar"
                className="form-input w-full text-sm"
              />
            </div>
          </div>

          {/* Variables disponibles */}
          <div>
            <p className="text-2xs text-slate-600 mb-1.5">Variables disponibles (click para insertar):</p>
            <div className="flex flex-wrap gap-1">
              {VARIABLES_BASE.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertarVariable(v)}
                  className="text-2xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-2xs text-slate-500 mt-1.5 leading-relaxed">
              <span className="font-mono">{'{{nombre}}'}</span> es solo el primer nombre del asegurado (ideal para saludos: "Hola Juan!").
              Usá <span className="font-mono">{'{{nombre_completo}}'}</span> si necesitás el nombre completo tal como está cargado en la ficha.
            </p>
          </div>

          {/* Asunto */}
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Asunto del email *</label>
            <input
              type="text"
              name="asunto"
              value={asunto}
              onChange={e => setAsunto(e.target.value)}
              onFocus={e => { focusedRef.current = e.target }}
              placeholder="Promoción especial para vos"
              className="form-input w-full text-sm"
              maxLength={300}
            />
          </div>

          {/* Saludo */}
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Saludo</label>
            <input
              type="text"
              name="saludo"
              value={saludo}
              onChange={e => setSaludo(e.target.value)}
              onFocus={e => { focusedRef.current = e.target }}
              className="form-input w-full text-sm"
            />
          </div>

          {/* Cuerpo */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-2xs font-medium text-slate-600">Cuerpo del mensaje *</label>
              <button
                type="button"
                onClick={() => setSelectorImagenAbierto(true)}
                className="text-xs px-3 py-1.5 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 hover:border-blue-300 flex items-center gap-1.5 text-blue-700 font-medium"
              >
                <ImageIcon className="h-3.5 w-3.5" /> Insertar imagen
              </button>
            </div>
            <textarea
              name="cuerpo"
              ref={cuerpoRef}
              value={cuerpo}
              onChange={e => setCuerpo(e.target.value)}
              onFocus={e => { focusedRef.current = e.target }}
              placeholder="Escribí el contenido del email. Podés usar variables como {{nombre}} y saltos de línea."
              className="form-input w-full text-sm font-mono"
              rows={8}
            />
          </div>

          {/* CTA opcional */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
            <p className="text-2xs font-medium text-slate-700">Botón de acción (opcional)</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={ctaTexto}
                onChange={e => setCtaTexto(e.target.value)}
                placeholder="Texto del botón (ej: Ver promoción)"
                className="form-input w-full text-sm"
                maxLength={80}
              />
              <input
                type="url"
                value={ctaUrl}
                onChange={e => setCtaUrl(e.target.value)}
                placeholder="https://..."
                className="form-input w-full text-sm"
              />
            </div>
          </div>

          {/* Cierre */}
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Cierre / despedida</label>
            <textarea
              name="cierre"
              value={cierre}
              onChange={e => setCierre(e.target.value)}
              onFocus={e => { focusedRef.current = e.target }}
              className="form-input w-full text-sm"
              rows={2}
            />
          </div>

          {/* Preview toggle */}
          <div>
            <button
              onClick={() => setPreviewAbierto(!previewAbierto)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Eye className="h-3 w-3" /> {previewAbierto ? 'Ocultar' : 'Mostrar'} vista previa
            </button>
            {previewAbierto && (
              <div className="mt-2 border border-slate-200 rounded overflow-hidden">
                {previewCargando ? (
                  <div className="py-8 text-center bg-slate-50">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-500 mx-auto" />
                  </div>
                ) : previewHtml ? (
                  <iframe
                    sandbox="allow-same-origin allow-popups"
                    srcDoc={previewHtml}
                    className="w-full bg-white"
                    style={{ height: '500px', border: 'none' }}
                  />
                ) : (
                  <div className="py-8 text-center text-xs text-slate-500 bg-slate-50">
                    Editá los campos para generar el preview
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onCerrar} disabled={guardando} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="btn-primary flex items-center gap-1.5">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {esNueva ? 'Crear plantilla' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* Selector de imagen de la biblioteca (v1.0.142) */}
      <SelectorImagenBiblioteca
        abierto={selectorImagenAbierto}
        onCerrar={() => setSelectorImagenAbierto(false)}
        onElegir={insertarImagenEnCuerpo}
        titulo="Insertar imagen en el cuerpo"
      />
    </div>
  )
}
