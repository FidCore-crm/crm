'use client'

import { useEffect, useState } from 'react'
import { Download, Share, Plus, X, Smartphone } from 'lucide-react'
import { derivarTonos, COLOR_MARCA_DEFAULT } from '@/lib/color-marca'

interface Props {
  /** Color de marca del PAS (hex). Si no viene, usa navy default. */
  colorMarca?: string | null
}

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

export default function InstalarAppBanner({ colorMarca }: Props) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [mostrarBanner, setMostrarBanner] = useState(false)
  const [mostrarModalIOS, setMostrarModalIOS] = useState(false)
  const [esDispositivoIOS, setEsDispositivoIOS] = useState(false)

  // Tonos derivados del color de marca del PAS para que el banner luzca como
  // un acento del portal (no como un Toast genérico). Cae a navy si el PAS no
  // configuró color de marca.
  const tonos = derivarTonos(colorMarca || COLOR_MARCA_DEFAULT)

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
      {/* Banner prominente con color de marca del PAS. Animación de entrada
          y pulso suave en el ícono para que el cliente lo note sin sentirse
          interrumpido. */}
      <style jsx>{`
        @keyframes portal-banner-in {
          0%   { opacity: 0; transform: translateY(-8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes portal-icon-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.08); }
        }
        .banner-anim { animation: portal-banner-in 0.45s ease-out both; }
        .icon-anim   { animation: portal-icon-pulse 2.4s ease-in-out infinite; }
      `}</style>
      <div
        className="banner-anim relative rounded-2xl p-4 flex items-start gap-3 shadow-lg overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.oscuro} 100%)`,
          color: tonos.textoSobreColor,
        }}
      >
        {/* Halo decorativo sutil para dar profundidad */}
        <div
          aria-hidden="true"
          className="absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-20"
          style={{ background: tonos.vibrante }}
        />
        <div
          className="icon-anim h-11 w-11 rounded-xl flex items-center justify-center shrink-0 relative z-10"
          style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(2px)' }}
        >
          <Smartphone className="h-6 w-6" style={{ color: tonos.textoSobreColor }} />
        </div>
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="text-base font-bold leading-tight">Instalá tu portal en el celular</h3>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: tonos.textoSobreColor, opacity: 0.92 }}>
            {esDispositivoIOS
              ? 'Tenelo a un toque en tu pantalla de inicio, sin tener que entrar al navegador cada vez.'
              : 'Tenelo a un toque, sin tener que entrar al navegador cada vez.'}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={instalar}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg min-h-[40px] shadow-sm transition-transform active:scale-95"
              style={{
                background: tonos.textoSobreColor === '#FFFFFF' ? '#FFFFFF' : tonos.base,
                color: tonos.textoSobreColor === '#FFFFFF' ? tonos.base : '#FFFFFF',
              }}
            >
              <Download className="h-4 w-4" />
              Instalar app
            </button>
            <button
              onClick={descartar}
              className="px-3 py-2 text-xs min-h-[40px]"
              style={{ color: tonos.textoSobreColor, opacity: 0.75 }}
            >
              Ahora no
            </button>
          </div>
        </div>
        <button
          onClick={descartar}
          aria-label="Cerrar"
          className="shrink-0 relative z-10 transition-opacity"
          style={{ color: tonos.textoSobreColor, opacity: 0.6 }}
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
