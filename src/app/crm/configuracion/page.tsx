'use client'

import { useRouter } from 'next/navigation'
import { Building2, Settings, Globe, Bell, Users, Shield, ChevronRight, Mail, HardDrive, MessageSquare, ExternalLink, Sparkles, AlertTriangle, Power, Download, BarChart3, Inbox } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { esModoAppliance } from '@/lib/modo-instalacion'

const secciones = [
  {
    href: '/crm/configuracion/perfil',
    icon: Building2,
    titulo: 'Perfil',
    descripcion: 'Nombre, logo, matrícula y datos de contacto',
    activo: true,
  },
  {
    href: '/crm/configuracion/catalogos',
    icon: Settings,
    titulo: 'Catálogos',
    descripcion: 'Compañías, ramos, coberturas y más',
    activo: true,
  },
  {
    href: '/crm/configuracion/correos',
    icon: Mail,
    titulo: 'Correos',
    descripcion: 'Servidor SMTP y datos del remitente',
    activo: true,
  },
  {
    href: '/crm/configuracion/agente-ia',
    icon: Sparkles,
    titulo: 'Inteligencia Artificial',
    descripcion: 'Configurá las funciones inteligentes del CRM',
    activo: true,
    adminOnly: true,
  },
  {
    href: '/crm/configuracion/comunicaciones',
    icon: MessageSquare,
    titulo: 'Comunicaciones',
    descripcion: 'Plantillas, envíos automáticos y bajas',
    activo: true,
  },
  {
    href: '/crm/configuracion/backups',
    icon: HardDrive,
    titulo: 'Backups',
    descripcion: 'Sistema de backups automáticos y restauración',
    activo: true,
  },
  {
    href: '/crm/configuracion/formulario-publico',
    icon: Globe,
    titulo: 'Formulario público',
    descripcion: 'Configurá el formulario de denuncia para tus clientes',
    activo: true,
  },
  {
    href: '/crm/configuracion/leads-web',
    icon: Inbox,
    titulo: 'Leads desde web',
    descripcion: 'Recibí leads del formulario de contacto de tu sitio web',
    activo: true,
    adminOnly: true,
  },
  {
    href: '/crm/configuracion/portal-cliente',
    icon: ExternalLink,
    titulo: 'Portal del Asegurado',
    descripcion: 'Acceso para que tus asegurados vean sus pólizas y siniestros',
    activo: true,
  },
  {
    href: '/crm/configuracion/notificaciones',
    icon: Bell,
    titulo: 'Notificaciones',
    descripcion: 'Alertas automáticas de vencimientos y siniestros',
    activo: true,
  },
  {
    href: '/crm/configuracion/dashboard',
    icon: BarChart3,
    titulo: 'Panel de Análisis',
    descripcion: 'Elegí qué gráficos ver en el dashboard de análisis de cartera',
    activo: true,
    adminOnly: true,
  },
  {
    href: '/crm/configuracion/usuarios',
    icon: Users,
    titulo: 'Usuarios',
    descripcion: 'Gestioná los accesos al sistema',
    activo: true,
  },
  {
    href: '/crm/configuracion/errores-sistema',
    icon: AlertTriangle,
    titulo: 'Errores del sistema',
    descripcion: 'Errores críticos persistidos con detalle técnico',
    activo: true,
    adminOnly: true,
  },
  {
    href: '/crm/configuracion/sistema',
    icon: Power,
    titulo: 'Sistema',
    descripcion: 'Apagar o reiniciar el servidor del CRM',
    activo: true,
    adminOnly: true,
    applianceOnly: true,
  },
  {
    href: '/crm/configuracion/licencia',
    icon: Shield,
    titulo: 'Licencia',
    descripcion: 'Estado de tu suscripción y carga de nueva licencia',
    activo: true,
    adminOnly: true,
  },
  {
    href: '/crm/configuracion/actualizaciones',
    icon: Download,
    titulo: 'Actualizaciones',
    descripcion: 'Verificar e instalar nuevas versiones del CRM',
    activo: true,
    adminOnly: true,
  },
]

export default function ConfiguracionPage() {
  const router = useRouter()
  const { isAdmin } = useAuth()

  const modoAppliance = esModoAppliance()
  const seccionesVisibles = secciones.filter(s => {
    if (s.adminOnly && !isAdmin) return false
    if ((s as any).applianceOnly && !modoAppliance) return false
    return true
  })

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Configuración</h1>
        <p className="text-xs text-slate-500">Ajustes generales del sistema</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3">
        {seccionesVisibles.map(s => (
          <div
            key={s.titulo}
            onClick={() => s.activo && router.push(s.href)}
            className={`bg-white border rounded p-4 flex items-start gap-3 transition-all ${
              s.activo
                ? 'border-slate-200 cursor-pointer hover:border-blue-400 hover:shadow-sm'
                : 'border-slate-200 opacity-50 cursor-default'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded shrink-0 ${
              s.activo ? 'bg-blue-50' : 'bg-slate-50'
            }`}>
              <s.icon className={`h-4 w-4 ${s.activo ? 'text-blue-600' : 'text-slate-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-slate-800">{s.titulo}</h3>
                {!s.activo && (
                  <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                    Próximamente
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{s.descripcion}</p>
            </div>
            {s.activo && <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 mt-1" />}
          </div>
        ))}
      </div>
    </div>
  )
}
