'use client'

import { useEffect, useState } from 'react'
import { Download, Share, Plus, X, Smartphone } from 'lucide-react'

// Tipo del evento beforeinstallprompt (no está en el tipado standard de TS).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const STORAGE_KEY_DESCARTADO = 'portal_install_banner_dismissed_v1'

function esIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPad en iPadOS 13+ se reporta como Macintosh con touch — chequeamos ambos
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document)
}

function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  // PWA instalada → display-mode standalone
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari standalone
  if ((window.navigator as any).standalone === true) return true
  return false
}

export default function InstalarAppBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [mostrarBanner, setMostrarBanner] = useState(false)
  const [mostrarModalIOS, setMostrarModalIOS] = useState(false)
  const [esDispositivoIOS, setEsDispositivoIOS] = useState(false)

  useEffect(() => {
    if (estaInstalada()) return
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(STORAGE_KEY_DESCARTADO) === '1') return

    const ios = esIOS()
    setEsDispositivoIOS(ios)

    if (ios) {
      // iOS no dispara beforeinstallprompt — mostramos directo el banner
      // con instrucciones manuales.
      setMostrarBanner(true)
      return
    }

    // Android / desktop: esperar a que el browser dispare el evento
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setMostrarBanner(true)
    }

    const onAppInstalled = () => {
      setMostrarBanner(false)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  function descartar() {
    setMostrarBanner(false)
    setMostrarModalIOS(false)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY_DESCARTADO, '1')
    }
  }

  async function instalar() {
    if (esDispositivoIOS) {
      setMostrarModalIOS(true)
      return
    }
    if (!promptEvent) return
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      if (choice.outcome === 'accepted') {
        setMostrarBanner(false)
      }
      setPromptEvent(null)
    } catch {
      // Algunos browsers solo permiten un prompt — si falló, dejamos el banner
    }
  }

  if (!mostrarBanner) return null

  return (
    <>
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
        <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <Smartphone className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">Tené tu portal a un toque</h3>
          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
            {esDispositivoIOS
              ? 'Instalá esta app en tu pantalla de inicio para acceder rápido sin abrir el navegador.'
              : 'Instalá esta app en tu celular para acceder más rápido y verla a pantalla completa.'}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={instalar}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg min-h-[36px]"
            >
              <Download className="h-3.5 w-3.5" />
              Instalar app
            </button>
            <button
              onClick={descartar}
              className="px-3 py-2 text-xs text-slate-500 hover:text-slate-700 min-h-[36px]"
            >
              Ahora no
            </button>
          </div>
        </div>
        <button
          onClick={descartar}
          aria-label="Cerrar"
          className="text-slate-400 hover:text-slate-600 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Modal con instrucciones para iOS */}
      {mostrarModalIOS && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setMostrarModalIOS(false)}
        >
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Instalar en iPhone / iPad</h3>
              <button
                onClick={() => setMostrarModalIOS(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-sm text-slate-600">
                En Safari seguí estos pasos para agregar el portal a tu pantalla de inicio:
              </p>
              <ol className="flex flex-col gap-3">
                <li className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div className="flex-1 text-sm text-slate-700">
                    Tocá el botón <span className="inline-flex items-center gap-1 font-medium"><Share className="h-4 w-4 text-blue-600" />Compartir</span> abajo.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div className="flex-1 text-sm text-slate-700">
                    Bajá hasta encontrar <span className="inline-flex items-center gap-1 font-medium"><Plus className="h-4 w-4 text-blue-600" />Agregar a pantalla de inicio</span>.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div className="flex-1 text-sm text-slate-700">
                    Confirmá tocando <span className="font-semibold">Agregar</span> arriba a la derecha.
                  </div>
                </li>
              </ol>
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                Listo. Vas a ver el icono del portal en tu pantalla de inicio como cualquier otra app.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-200">
              <button
                onClick={() => setMostrarModalIOS(false)}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg min-h-[44px]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
