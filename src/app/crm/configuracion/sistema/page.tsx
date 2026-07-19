'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ArrowLeft, Power, RotateCcw, AlertTriangle, X } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { esModoAppliance } from '@/lib/modo-instalacion'

type Accion = 'apagar' | 'reiniciar'

const COUNTDOWN_SEGUNDOS = 30
const PALABRAS_CONFIRMACION: Record<Accion, string> = {
  apagar: 'APAGAR',
  reiniciar: 'REINICIAR',
}

export default function SistemaPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [accionActiva, setAccionActiva] = useState<Accion | null>(null)
  const [segundos, setSegundos] = useState(COUNTDOWN_SEGUNDOS)
  const [textoConfirmacion, setTextoConfirmacion] = useState('')
  const [ejecutando, setEjecutando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const palabraEsperada = accionActiva ? PALABRAS_CONFIRMACION[accionActiva] : ''
  const textoOk = palabraEsperada !== '' && textoConfirmacion.trim().toUpperCase() === palabraEsperada

  // Guard de admin + modo APPLIANCE (en VPS estas funciones no aplican)
  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
      return
    }
    if (!authLoading && !esModoAppliance()) {
      router.push('/crm/configuracion')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Countdown — al llegar a 0 cancela (NO auto-ejecuta para evitar accidentes)
  useEffect(() => {
    if (!accionActiva || ejecutando) return
    if (segundos <= 0) {
      cancelar()
      return
    }
    intervalRef.current = setInterval(() => {
      setSegundos(s => s - 1)
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accionActiva, segundos, ejecutando])

  function abrirConfirmacion(a: Accion) {
    setAccionActiva(a)
    setSegundos(COUNTDOWN_SEGUNDOS)
    setTextoConfirmacion('')
    setResultado(null)
    setEjecutando(false)
  }

  function cancelar() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setAccionActiva(null)
    setSegundos(COUNTDOWN_SEGUNDOS)
    setTextoConfirmacion('')
    setEjecutando(false)
    setResultado(null)
  }

  async function ejecutar() {
    if (!accionActiva || ejecutando) return
    if (!textoOk) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    setEjecutando(true)

    const url = accionActiva === 'apagar' ? '/api/sistema/apagar' : '/api/sistema/reiniciar'
    const r = await apiCall<{ mensaje?: string }>(url, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setResultado(
        accionActiva === 'apagar'
          ? 'El servidor se está apagando. Vas a perder acceso al CRM en unos segundos. Para encenderlo de nuevo necesitás presionar el botón físico del servidor.'
          : 'El servidor se está reiniciando. La conexión se va a cortar en unos segundos. Volvé a entrar al CRM en 1 a 2 minutos.'
      )
    } else {
      setEjecutando(false)
      toast.error(r.error?.mensaje || 'No se pudo ejecutar la acción')
      cancelar()
    }
  }

  if (authLoading || !isAdmin) {
    return <div className="p-8 text-sm text-slate-600">Verificando permisos...</div>
  }

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/crm/configuracion')}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Power className="h-5 w-5 text-slate-600" />
          Sistema
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Apagado y reinicio del servidor del CRM. Solo para administradores.
        </p>
      </div>

      {/* Aviso */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <p className="font-semibold mb-1">Antes de apagar o reiniciar</p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-800">
            <li>Asegurate de que ningún otro usuario esté trabajando en el CRM.</li>
            <li>Si apagás el servidor vas a tener que <strong>encenderlo presionando el botón físico</strong>.</li>
            <li>Reiniciar tarda 1 a 2 minutos. Apagar tarda solo unos segundos.</li>
          </ul>
        </div>
      </div>

      {/* Botones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Reiniciar */}
        <button
          onClick={() => abrirConfirmacion('reiniciar')}
          disabled={!!accionActiva}
          className="bg-white border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 active:bg-blue-50 transition-colors rounded-2xl p-6 flex flex-col items-center text-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center">
            <RotateCcw className="h-7 w-7 text-blue-700" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">Reiniciar servidor</h2>
            <p className="text-2xs text-slate-600 mt-1">
              Apaga y vuelve a encender el servidor. Útil para aplicar actualizaciones.
            </p>
          </div>
        </button>

        {/* Apagar */}
        <button
          onClick={() => abrirConfirmacion('apagar')}
          disabled={!!accionActiva}
          className="bg-white border-2 border-slate-200 hover:border-red-400 hover:bg-red-50/50 active:bg-red-50 transition-colors rounded-2xl p-6 flex flex-col items-center text-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
            <Power className="h-7 w-7 text-red-700" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">Apagar servidor</h2>
            <p className="text-2xs text-slate-600 mt-1">
              Apaga el servidor por completo. Necesitás acceso físico para encenderlo.
            </p>
          </div>
        </button>
      </div>

      {/* Modal de confirmación con countdown */}
      {accionActiva && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
            {!resultado ? (
              <>
                <div className={`px-5 py-4 ${accionActiva === 'apagar' ? 'bg-red-50 border-b border-red-100' : 'bg-blue-50 border-b border-blue-100'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${accionActiva === 'apagar' ? 'bg-red-100' : 'bg-blue-100'}`}>
                      {accionActiva === 'apagar' ? (
                        <Power className="h-5 w-5 text-red-700" />
                      ) : (
                        <RotateCcw className="h-5 w-5 text-blue-700" />
                      )}
                    </div>
                    <div>
                      <h3 className={`text-base font-semibold ${accionActiva === 'apagar' ? 'text-red-900' : 'text-blue-900'}`}>
                        {accionActiva === 'apagar' ? '¿Apagar el servidor?' : '¿Reiniciar el servidor?'}
                      </h3>
                      <p className={`text-2xs mt-0.5 ${accionActiva === 'apagar' ? 'text-red-700' : 'text-blue-700'}`}>
                        {accionActiva === 'apagar'
                          ? 'Vas a perder acceso al CRM hasta que enciendas el servidor manualmente.'
                          : 'El CRM va a estar inaccesible durante 1 a 2 minutos.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-5 flex flex-col gap-4">
                  {ejecutando ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      Enviando orden al servidor...
                    </p>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Para confirmar, escribí{' '}
                          <span className={`font-mono font-bold ${accionActiva === 'apagar' ? 'text-red-700' : 'text-blue-700'}`}>
                            {palabraEsperada}
                          </span>
                          {' '}en el campo:
                        </label>
                        <input
                          type="text"
                          autoFocus
                          autoComplete="off"
                          spellCheck={false}
                          value={textoConfirmacion}
                          onChange={e => setTextoConfirmacion(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && textoOk) ejecutar() }}
                          placeholder={palabraEsperada}
                          className={`w-full px-3 py-2.5 text-sm font-mono uppercase border rounded-lg focus:outline-none focus:ring-2 ${
                            textoOk
                              ? 'border-emerald-300 focus:ring-emerald-200 bg-emerald-50/40'
                              : 'border-slate-300 focus:ring-blue-200'
                          }`}
                        />
                        <p className="text-2xs text-slate-600 mt-1.5 flex items-center gap-1">
                          {textoOk ? (
                            <span className="text-emerald-700">✓ Confirmado, podés ejecutar</span>
                          ) : (
                            <>El modal se cancela en <span className="font-semibold tabular-nums">{segundos}s</span> si no escribís la palabra.</>
                          )}
                        </p>
                      </div>

                      <div className="flex gap-2 w-full">
                        <button
                          onClick={cancelar}
                          className="flex-1 px-4 py-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg min-h-[48px] flex items-center justify-center gap-2"
                        >
                          <X className="h-4 w-4" />
                          Cancelar
                        </button>
                        <button
                          onClick={ejecutar}
                          disabled={!textoOk}
                          className={`flex-1 px-4 py-3 text-sm font-semibold text-white rounded-lg min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed ${
                            accionActiva === 'apagar'
                              ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                          }`}
                        >
                          {accionActiva === 'apagar' ? 'Apagar ahora' : 'Reiniciar ahora'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="p-6 flex flex-col items-center text-center gap-3">
                <div className={`h-14 w-14 rounded-full flex items-center justify-center ${accionActiva === 'apagar' ? 'bg-red-100' : 'bg-blue-100'}`}>
                  {accionActiva === 'apagar' ? (
                    <Power className="h-7 w-7 text-red-700" />
                  ) : (
                    <RotateCcw className="h-7 w-7 text-blue-700" />
                  )}
                </div>
                <h3 className="text-base font-semibold text-slate-800">
                  {accionActiva === 'apagar' ? 'Apagando servidor' : 'Reiniciando servidor'}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">{resultado}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
