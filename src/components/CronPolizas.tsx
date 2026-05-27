'use client'

import { useEffect } from 'react'

const INTERVALO_MS = 6 * 60 * 60 * 1000 // 6 horas
const STORAGE_KEY = 'cron_polizas_last'

// Fallback client-side del cron de pólizas.
// Se ejecuta desde el browser del usuario logueado (cookie `crm_session`).
// El endpoint /api/cron/polizas acepta sesión de ADMIN como alternativa al
// header `Authorization: Bearer $CRON_SECRET` (ver src/lib/cron-auth.ts).
// Para usuarios no-admin el request será rechazado silenciosamente (401);
// el cron real sigue corriendo por systemd cada 4h.
export function CronPolizas() {
  useEffect(() => {
    const ejecutar = async () => {
      const last = localStorage.getItem(STORAGE_KEY)
      const hoy = new Date().toISOString().split('T')[0]
      if (last === hoy) return

      try {
        const res = await fetch('/api/cron/polizas', { credentials: 'include' })
        if (res.ok) {
          localStorage.setItem(STORAGE_KEY, hoy)
        }
      } catch {
        // silencioso
      }
    }

    ejecutar()
    const timer = setInterval(ejecutar, INTERVALO_MS)
    return () => clearInterval(timer)
  }, [])

  return null
}
