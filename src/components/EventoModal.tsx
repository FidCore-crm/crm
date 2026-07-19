'use client'

// ============================================================
// Modal para crear o editar un evento independiente del calendario.
// Los eventos NO están atados a personas/pólizas/siniestros — sirven
// como agenda personal o del equipo. Ver migración 113_eventos.sql.
// ============================================================

import { useState, useEffect } from 'react'
import { X, Save, Trash2, Loader2, Calendar, Clock, Repeat, Users, User, CheckCircle } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { calcularSiguienteFechaRecurrencia } from '@/lib/utils'

export interface Evento {
  id?: string
  usuario_id?: string
  titulo: string
  descripcion?: string | null
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  categoria?: string | null
  recurrencia: 'NINGUNA' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'ANUAL'
  estado: 'PROGRAMADO' | 'COMPLETADO' | 'CANCELADO'
  compartido: boolean
  nota_cierre?: string | null
}

interface Props {
  evento?: Evento | null
  fechaInicial?: string
  onCerrar: () => void
  onGuardado: () => void
}

const RECURRENCIAS: Array<{ valor: Evento['recurrencia']; label: string }> = [
  { valor: 'NINGUNA', label: 'Sin recurrencia' },
  { valor: 'DIARIA', label: 'Diaria' },
  { valor: 'SEMANAL', label: 'Semanal' },
  { valor: 'MENSUAL', label: 'Mensual' },
  { valor: 'ANUAL', label: 'Anual' },
]

// Sugerencias de categorías comunes — el PAS puede escribir libremente
// pero le damos ideas para clickear.
const CATEGORIAS_SUGERIDAS = ['Personal', 'Trabajo', 'Formación', 'Reunión', 'Vencimiento']

export default function EventoModal({ evento, fechaInicial, onCerrar, onGuardado }: Props) {
  const esEdicion = Boolean(evento?.id)

  const [titulo, setTitulo] = useState(evento?.titulo ?? '')
  const [descripcion, setDescripcion] = useState(evento?.descripcion ?? '')
  const [fecha, setFecha] = useState(evento?.fecha ?? fechaInicial ?? new Date().toISOString().slice(0, 10))
  const [horaInicio, setHoraInicio] = useState(evento?.hora_inicio ?? '')
  const [horaFin, setHoraFin] = useState(evento?.hora_fin ?? '')
  const [categoria, setCategoria] = useState(evento?.categoria ?? '')
  const [recurrencia, setRecurrencia] = useState<Evento['recurrencia']>(evento?.recurrencia ?? 'NINGUNA')
  const [compartido, setCompartido] = useState(evento?.compartido ?? false)

  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [completando, setCompletando] = useState(false)

  // Escape cierra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCerrar])

  async function guardar() {
    if (!titulo.trim()) {
      toast.error('El título es obligatorio')
      return
    }
    if (horaInicio && horaFin && horaFin < horaInicio) {
      toast.error('La hora de fin no puede ser anterior a la hora de inicio')
      return
    }

    setGuardando(true)
    const payload = {
      titulo: titulo.trim(),
      descripcion: descripcion?.trim() || null,
      fecha,
      hora_inicio: horaInicio || null,
      hora_fin: horaFin || null,
      categoria: categoria?.trim() || null,
      recurrencia,
      compartido,
    }
    const res = esEdicion
      ? await apiCall(`/api/eventos/${evento!.id}`, { method: 'PATCH', body: payload })
      : await apiCall('/api/eventos', { method: 'POST', body: payload })
    setGuardando(false)

    if (res.ok) {
      toast.exito(esEdicion ? 'Evento actualizado' : 'Evento creado')
      onGuardado()
      onCerrar()
    }
  }

  async function eliminar() {
    if (!esEdicion) return
    if (!confirm('¿Eliminar este evento? Esta acción no se puede deshacer.')) return
    setEliminando(true)
    const res = await apiCall(`/api/eventos/${evento!.id}`, { method: 'DELETE' })
    setEliminando(false)
    if (res.ok) {
      toast.exito('Evento eliminado')
      onGuardado()
      onCerrar()
    }
  }

  async function completar() {
    if (!esEdicion) return
    setCompletando(true)
    // 1) Marcar el actual como COMPLETADO
    const res = await apiCall(`/api/eventos/${evento!.id}`, {
      method: 'PATCH',
      body: { estado: 'COMPLETADO' },
    })
    if (!res.ok) {
      setCompletando(false)
      return
    }
    // 2) Si es recurrente, crear la siguiente instancia con la fecha calculada
    if (recurrencia !== 'NINGUNA') {
      const nuevaFecha = calcularSiguienteFechaRecurrencia(fecha, recurrencia)
      await apiCall('/api/eventos', {
        method: 'POST',
        body: {
          titulo: titulo.trim(),
          descripcion: descripcion?.trim() || null,
          fecha: nuevaFecha,
          hora_inicio: horaInicio || null,
          hora_fin: horaFin || null,
          categoria: categoria?.trim() || null,
          recurrencia,
          compartido,
        },
      }, { mostrar_toast_en_error: false })
    }
    setCompletando(false)
    toast.exito(recurrencia !== 'NINGUNA' ? 'Evento completado — se creó la siguiente instancia' : 'Evento completado')
    onGuardado()
    onCerrar()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCerrar}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-emerald-50">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-emerald-800">
              {esEdicion ? 'Editar evento' : 'Nuevo evento'}
            </h3>
          </div>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Título<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="form-input w-full"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ej: Reunión con Juan, Curso SSN, Cumpleaños..."
              autoFocus
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
            <textarea
              className="form-input w-full resize-none"
              rows={2}
              value={descripcion ?? ''}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Detalles opcionales..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Fecha<span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className="form-input w-full"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Hora inicio
              </label>
              <input
                type="time"
                className="form-input w-full"
                value={horaInicio ?? ''}
                onChange={e => setHoraInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Hora fin
              </label>
              <input
                type="time"
                className="form-input w-full"
                value={horaFin ?? ''}
                onChange={e => setHoraFin(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Categoría</label>
            <input
              type="text"
              className="form-input w-full"
              value={categoria ?? ''}
              onChange={e => setCategoria(e.target.value)}
              placeholder="Personal, Trabajo, Formación..."
              maxLength={60}
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {CATEGORIAS_SUGERIDAS.map(sug => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setCategoria(sug)}
                  className={`text-2xs px-2 py-0.5 rounded border transition-colors ${
                    categoria === sug
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
              <Repeat className="h-3 w-3" /> Recurrencia
            </label>
            <select
              className="form-input w-full"
              value={recurrencia}
              onChange={e => setRecurrencia(e.target.value as Evento['recurrencia'])}
            >
              {RECURRENCIAS.map(r => (
                <option key={r.valor} value={r.valor}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Visibilidad</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCompartido(false)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs transition-colors ${
                  !compartido
                    ? 'bg-slate-100 text-slate-800 border-slate-400 font-medium'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <User className="h-3.5 w-3.5" /> Privado
              </button>
              <button
                type="button"
                onClick={() => setCompartido(true)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs transition-colors ${
                  compartido
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-400 font-medium'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Users className="h-3.5 w-3.5" /> Equipo
              </button>
            </div>
            <p className="text-2xs text-slate-600 mt-1">
              {compartido
                ? 'Todos los usuarios de la productora verán este evento.'
                : 'Solo vos vas a ver este evento.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg gap-2">
          {esEdicion ? (
            <div className="flex items-center gap-2">
              <button
                onClick={eliminar}
                disabled={eliminando || guardando || completando}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {eliminando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Eliminar
              </button>
              {evento?.estado === 'PROGRAMADO' && (
                <button
                  onClick={completar}
                  disabled={eliminando || guardando || completando}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  title={recurrencia !== 'NINGUNA' ? 'Al completar se crea la siguiente instancia' : 'Marcar como completado'}
                >
                  {completando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                  Completar
                </button>
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button onClick={onCerrar} className="btn-secondary" disabled={guardando || eliminando || completando}>Cancelar</button>
            <button
              onClick={guardar}
              disabled={guardando || eliminando || completando}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
