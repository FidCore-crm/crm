'use client'

import { useRouter } from 'next/navigation'
import { AlertTriangle, XCircle, Clock } from 'lucide-react'
import { useLicenciaEstado } from '@/contexts/LicenciaContext'
import { useAuth } from '@/contexts/AuthContext'
import { esModoVps } from '@/lib/modo-instalacion'

/**
 * Banner sticky arriba de toda la app que avisa sobre vencimiento de licencia.
 * Aparece cuando:
 *   - Faltan <= 30 días para que venza la licencia activa.
 *   - La licencia ya venció (modo gracia interno o bloqueada).
 *   - No hay licencia cargada.
 *
 * Color escalonado: amarillo → naranja → rojo según urgencia.
 *
 * Si el usuario hace click va a /crm/configuracion/licencia (solo si es admin;
 * los no-admin lo ven informativo).
 */
export function BannerLicencia() {
  const router = useRouter()
  const { estado, loading } = useLicenciaEstado()
  const { isAdmin } = useAuth()

  // En modo VPS el sistema de licencias no aplica — nunca mostrar el banner.
  if (esModoVps()) return null

  if (loading || !estado) return null

  const activa = estado.licencia_activa
  const modo = estado.modo

  // Plan permanente nunca muestra banner
  if (modo === 'ACTIVA' && activa?.es_permanente) return null

  let bgColor = ''
  let textColor = ''
  let borderColor = ''
  let Icono = AlertTriangle
  let mensaje = ''

  if (modo === 'ACTIVA' && activa) {
    if (activa.dias_restantes > 30) return null
    if (activa.dias_restantes > 15) {
      bgColor = 'bg-amber-50'
      textColor = 'text-amber-800'
      borderColor = 'border-amber-200'
      Icono = Clock
      mensaje = `Tu licencia FidCore vence en ${activa.dias_restantes} días. Contactá a tu proveedor para renovar.`
    } else if (activa.dias_restantes > 7) {
      bgColor = 'bg-orange-50'
      textColor = 'text-orange-800'
      borderColor = 'border-orange-300'
      Icono = AlertTriangle
      mensaje = `Tu licencia vence en ${activa.dias_restantes} días. Pedí la renovación cuanto antes.`
    } else if (activa.dias_restantes >= 0) {
      bgColor = 'bg-red-50'
      textColor = 'text-red-800'
      borderColor = 'border-red-300'
      Icono = AlertTriangle
      mensaje =
        activa.dias_restantes === 0
          ? 'Tu licencia vence HOY. Cargá la renovación cuanto antes para no perder funcionalidad.'
          : `Tu licencia vence en ${activa.dias_restantes} días. Cargá la renovación urgente.`
    }
  } else if (modo === 'GRACIA' && activa) {
    bgColor = 'bg-orange-100'
    textColor = 'text-orange-900'
    borderColor = 'border-orange-400'
    Icono = AlertTriangle
    mensaje = 'Tu licencia venció. Cargá una nueva para mantener todas las funciones activas.'
  } else if (modo === 'BLOQUEADA') {
    bgColor = 'bg-red-600'
    textColor = 'text-white'
    borderColor = 'border-red-700'
    Icono = XCircle
    mensaje = 'Tu licencia venció. Cargá una licencia válida para reactivar todas las funciones.'
  } else if (modo === 'SIN_LICENCIA') {
    bgColor = 'bg-red-600'
    textColor = 'text-white'
    borderColor = 'border-red-700'
    Icono = XCircle
    mensaje = 'Es necesario activar el sistema. Cargá tu licencia para habilitar todas las funciones.'
  } else {
    return null
  }

  const handleClick = () => {
    if (isAdmin) router.push('/crm/configuracion/licencia')
  }

  return (
    <div
      onClick={handleClick}
      className={`${bgColor} ${textColor} border-b ${borderColor} px-4 py-2 ${
        isAdmin ? 'cursor-pointer hover:brightness-95' : ''
      } transition-all`}
    >
      <div className="flex items-center justify-center gap-2 text-xs font-medium">
        <Icono className="h-4 w-4 shrink-0" />
        <span>{mensaje}</span>
        {isAdmin && (
          <span className="text-2xs opacity-80 ml-2">→ Click para gestionar licencia</span>
        )}
      </div>
    </div>
  )
}
