'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { XCircle, Shield, Loader2, FileText } from 'lucide-react'
import type { Restauracion } from '@/types/database'
import { apiCall } from '@/lib/api-client'

export default function RestauracionFallidaPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [restauracion, setRestauracion] = useState<Restauracion | null>(null)
  const [mostrarLog, setMostrarLog] = useState(false)

  useEffect(() => {
    apiCall<{ restauracion: Restauracion }>(`/api/backups/restaurar/${id}/estado`, {}, { mostrar_toast_en_error: false })
      .then((r) => {
        // UI no bloqueante si falla: la página muestra el loader hasta poder cargar el detalle del error
        if (r.ok && r.data) setRestauracion(r.data.restauracion)
      })
  }, [id])

  if (!restauracion) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="bg-red-50 border border-red-300 rounded-lg p-6 text-center">
        <XCircle className="h-14 w-14 text-red-500 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-red-900">La restauración falló</h1>
        <p className="text-sm text-red-800 mt-1">Los datos actuales NO fueron modificados (o solo parcialmente — revisá el log).</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Detalle</h2>
        <dl className="text-xs space-y-2">
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-600">Último estado alcanzado</dt>
            <dd className="text-slate-800 font-mono">{restauracion.estado}</dd>
          </div>
          <div className="border-b border-slate-100 pb-2">
            <dt className="text-slate-600 mb-1">Error</dt>
            <dd className="text-red-700 font-mono text-2xs bg-red-50 border border-red-200 rounded p-2">
              {restauracion.error_mensaje || 'Sin mensaje'}
            </dd>
          </div>
          {restauracion.pre_backup_id && (
            <div className="flex items-start gap-2 text-blue-700 pt-2">
              <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Hay un pre-backup de seguridad disponible. Si el CRM quedó en mal estado, podés restaurarlo para volver al momento previo a este intento.</span>
            </div>
          )}
        </dl>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Qué hacer</h3>
        <ol className="text-xs text-slate-600 list-decimal pl-5 space-y-1">
          <li>Verificá que el archivo .crmbak no esté corrupto (debería abrirse con tar/gzip)</li>
          <li>Verificá que el container de Postgres (supabase-db) esté corriendo</li>
          <li>Verificá que haya espacio suficiente en disco</li>
          <li>Revisá el log completo abajo para más detalles</li>
          <li>Si el problema persiste, contactá al soporte</li>
        </ol>
      </div>

      {restauracion.log_completo && (
        <div className="bg-white border border-slate-200 rounded-lg">
          <button
            onClick={() => setMostrarLog(!mostrarLog)}
            className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {mostrarLog ? 'Ocultar' : 'Ver'} log completo
          </button>
          {mostrarLog && (
            <pre className="text-2xs font-mono text-slate-600 bg-slate-50 border-t border-slate-200 p-3 max-h-96 overflow-y-auto whitespace-pre-wrap">
              {restauracion.log_completo}
            </pre>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={() => router.push('/crm/configuracion/backups')} className="btn-secondary text-xs px-3 py-1.5">
          Volver al panel de backups
        </button>
        <button onClick={() => router.push('/crm/configuracion/backups/restaurar')} className="btn-primary text-xs px-3 py-1.5">
          Intentar de nuevo
        </button>
      </div>
    </div>
  )
}
