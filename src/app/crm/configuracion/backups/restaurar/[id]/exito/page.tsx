'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle, Shield, Database, HardDrive, LogIn, Loader2 } from 'lucide-react'
import type { Restauracion } from '@/types/database'
import { apiCall } from '@/lib/api-client'

export default function RestauracionExitoPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [restauracion, setRestauracion] = useState<Restauracion | null>(null)

  useEffect(() => {
    apiCall<{ restauracion: Restauracion }>(`/api/backups/restaurar/${id}/estado`, {}, { mostrar_toast_en_error: false })
      .then((r) => {
        // UI no bloqueante si falla: la página muestra el loader hasta que el polling externo resuelva
        if (r.ok && r.data) setRestauracion(r.data.restauracion)
      })
  }, [id])

  if (!restauracion) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
  }

  const metadata = restauracion.metadata_backup || {}
  const duracion = restauracion.duracion_segundos || 0
  const min = Math.floor(duracion / 60)
  const seg = duracion % 60
  const duracionFmt = min > 0 ? `${min} min ${seg} seg` : `${seg} seg`

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="bg-green-50 border border-green-300 rounded-lg p-6 text-center">
        <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-green-900">Restauración completada</h1>
        <p className="text-sm text-green-800 mt-1">Todos los datos fueron restaurados correctamente.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Resumen</h2>
        <dl className="text-xs space-y-2">
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-600">Backup restaurado</dt>
            <dd className="text-slate-800 font-mono">{metadata.nombre || '-'}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-600">Fecha del backup</dt>
            <dd className="text-slate-800">{metadata.fecha ? new Date(metadata.fecha).toLocaleString('es-AR') : '-'}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-600">Duración</dt>
            <dd className="text-slate-800">{duracionFmt}</dd>
          </div>
          {restauracion.restaura_db && (
            <div className="flex items-center gap-2 text-green-700">
              <Database className="h-3.5 w-3.5" /> Base de datos restaurada
            </div>
          )}
          {restauracion.restaura_storage && (
            <div className="flex items-center gap-2 text-green-700">
              <HardDrive className="h-3.5 w-3.5" /> Storage restaurado
            </div>
          )}
          {restauracion.pre_backup_id && (
            <div className="flex items-center gap-2 text-blue-700 border-t border-slate-100 pt-2 mt-2">
              <Shield className="h-3.5 w-3.5" />
              <span>Pre-backup de seguridad disponible por si necesitás volver atrás</span>
            </div>
          )}
        </dl>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          🔐 Tu sesión se cerró automáticamente por seguridad. Volvé a iniciar sesión para acceder al CRM restaurado.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => router.push('/login')}
          className="btn-primary text-xs px-4 py-2 flex items-center gap-2"
        >
          <LogIn className="h-3.5 w-3.5" /> Ir al login
        </button>
      </div>
    </div>
  )
}
