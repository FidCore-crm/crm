'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FileText,
  AlertTriangle,
  CheckSquare,
  CalendarDays,
  DollarSign,
  Briefcase,
  UserPlus,
  Target,
  LayoutGrid,
  ChevronRight,
  Building2,
  RefreshCw,
  Bell,
  Upload,
  Mail,
  BookOpen,
} from 'lucide-react'
import { cn, hoyLocal } from '@/lib/utils'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, filtrarPorPersonas, obtenerIdsPersonas } from '@/lib/cartera-filter'

interface NavItem {
  href: string
  icon: any
  label: string
  sublabel?: string
  modulo?: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navItems: NavSection[] = [
  {
    label: 'Principal',
    items: [
      {
        href: '/crm/dashboard',
        icon: LayoutDashboard,
        label: 'Dashboard',
        modulo: 'dashboard',
      },
      {
        href: '/crm/notificaciones',
        icon: Bell,
        label: 'Notificaciones',
        modulo: 'notificaciones',
      },
    ],
  },
  {
    label: 'Cartera',
    items: [
      {
        href: '/crm/personas',
        icon: Users,
        label: 'Cartera',
        sublabel: 'Asegurados · Inactivos',
        modulo: 'personas',
      },
      {
        href: '/crm/polizas',
        icon: FileText,
        label: 'Pólizas',
        modulo: 'polizas',
      },
      {
        href: '/crm/renovaciones',
        icon: RefreshCw,
        label: 'Renovaciones',
        modulo: 'renovaciones',
      },
      {
        href: '/crm/siniestros',
        icon: AlertTriangle,
        label: 'Siniestros',
        modulo: 'siniestros',
      },
    ],
  },
  {
    label: 'Gestión',
    items: [
      {
        href: '/crm/tareas',
        icon: CheckSquare,
        label: 'Tareas',
        modulo: 'tareas',
      },
      {
        href: '/crm/calendario',
        icon: CalendarDays,
        label: 'Calendario',
        modulo: 'calendario',
      },
      {
        href: '/crm/facturacion',
        icon: DollarSign,
        label: 'Facturación',
        modulo: 'facturacion',
      },
    ],
  },
  {
    label: 'Comercial',
    items: [
      {
        href: '/crm/comercial',
        icon: Briefcase,
        label: 'Gestión comercial',
        modulo: 'comercial',
      },
      {
        href: '/crm/comercial/leads',
        icon: UserPlus,
        label: 'Leads',
        modulo: 'comercial',
      },
      {
        href: '/crm/comercial/oportunidades',
        icon: Target,
        label: 'Oportunidades',
        modulo: 'comercial',
      },
      {
        href: '/crm/comercial/cotizaciones',
        icon: FileText,
        label: 'Cotizaciones',
        modulo: 'comercial',
      },
      {
        href: '/crm/comercial/pipeline',
        icon: LayoutGrid,
        label: 'Pipeline',
        modulo: 'comercial',
      },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      {
        href: '/crm/comunicaciones',
        icon: Mail,
        label: 'Comunicaciones',
        sublabel: 'Emails enviados, plantillas y envíos masivos',
      },
      {
        href: '/crm/importar',
        icon: Upload,
        label: 'Importar cartera',
        modulo: 'importar',
      },
      {
        href: '/crm/ayuda',
        icon: BookOpen,
        label: 'Centro de Ayuda',
        sublabel: 'Guías cortas por módulo',
      },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { hasAccessTo, usuario } = useAuth()
  // Badges del sidebar — solo alertas accionables (cosas que requieren atención).
  // - tareasVencidas: tareas con fecha pasada sin completar
  // - renovacionesPerdidas: pólizas NO_VIGENTE sin renovación creada (oportunidad perdida)
  // - siniestrosSinRevisar: denuncias del portal del cliente que el PAS aún no revisó
  // No mostramos conteos totales (ej: 250 tareas) porque no son acción, son ruido.
  // Quitamos badges de leads/oportunidades/notificaciones — la campana ya muestra notif.
  const [tareasVencidas, setTareasVencidas] = useState(0)
  const [renovacionesPerdidas, setRenovacionesPerdidas] = useState(0)
  const [siniestrosSinRevisar, setSiniestrosSinRevisar] = useState(0)
  const [perfilNombre, setPerfilNombre] = useState('')
  const [perfilLogo, setPerfilLogo] = useState('')

  // ── Función de carga de contadores ──
  // Se ejecuta inicialmente y luego se invoca desde los handlers de Realtime
  // cuando hay cambios en tareas, polizas, leads, oportunidades o notificaciones.
  const cargarContadores = useCallback(async () => {
    if (!usuario) return
    const supabase = getSupabaseClient()
    const hoy = hoyLocal()

    const accesoTotal = tieneAccesoTotal(usuario)
    const idsPersonas = accesoTotal ? null : await obtenerIdsPersonas(supabase, usuario)

    // ── Tareas vencidas (fecha pasada + estado PENDIENTE/EN_PROCESO)
    let qTareas = supabase
      .from('tareas')
      .select('id', { count: 'exact', head: true })
      .lt('fecha_vencimiento', hoy)
      .in('estado', ['PENDIENTE', 'EN_PROCESO'])
    if (!accesoTotal) qTareas = filtrarPorPersonas(qTareas, idsPersonas, 'persona_id')

    // ── Siniestros denunciados desde el portal sin revisar
    let qSiniestros = supabase
      .from('siniestros')
      .select('id', { count: 'exact', head: true })
      .eq('origen_creacion', 'PORTAL_CLIENTE')
      .eq('revisado_por_pas', false)
      .is('deleted_at', null)
    if (!accesoTotal) qSiniestros = filtrarPorPersonas(qSiniestros, idsPersonas, 'persona_id')

    // ── Renovaciones "perdidas": pólizas que vencieron (NO_VIGENTE) y nadie creó
    // una renovación para ellas. Son oportunidades que se están escapando.
    // Estrategia: traer los poliza_origen_id de toda la cadena de hijas, después
    // contar NO_VIGENTE que NO estén en esa lista.
    const { data: hijas } = await supabase
      .from('polizas')
      .select('poliza_origen_id')
      .not('poliza_origen_id', 'is', null)
    const idsConRenovacion = Array.from(new Set(
      (hijas ?? []).map((h: any) => h.poliza_origen_id).filter(Boolean),
    ))

    let qRenov = supabase
      .from('polizas')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'NO_VIGENTE')
    if (idsConRenovacion.length > 0) {
      qRenov = qRenov.not('id', 'in', `(${idsConRenovacion.join(',')})`)
    }
    if (!accesoTotal && idsPersonas !== null) {
      qRenov = idsPersonas.length === 0
        ? qRenov.in('asegurado_id', ['00000000-0000-0000-0000-000000000000'])
        : qRenov.in('asegurado_id', idsPersonas)
    }

    const [{ count: tareas }, { count: siniestros }, { count: renov }] = await Promise.all([
      qTareas, qSiniestros, qRenov,
    ])
    setTareasVencidas(tareas ?? 0)
    setSiniestrosSinRevisar(siniestros ?? 0)
    setRenovacionesPerdidas(renov ?? 0)
  }, [usuario])

  // ── Debounce: si Realtime emite varios eventos juntos (ej: alta de
  //    persona + póliza + riesgo en cadena), agrupamos en un solo refetch
  //    diferido 300ms para no martillar el backend. ──
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refetchContadores = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    refetchTimerRef.current = setTimeout(() => { cargarContadores() }, 300)
  }, [cargarContadores])

  // ── Carga inicial + suscripciones Realtime ──
  //
  // Antes: setInterval(cargarContadores, 5 minutos).
  // Ahora: suscribimos a cambios en las 5 tablas que alimentan badges y
  // refetcheamos todos los contadores cuando alguna cambia. Debounce 300ms.
  // Revalidación on-focus por reconexión.
  useEffect(() => {
    if (!usuario) return
    const supabase = getSupabaseClient()

    cargarContadores()

    const onFocus = () => cargarContadores()
    window.addEventListener('focus', onFocus)

    const tablas: Array<{ tabla: 'tareas' | 'polizas' | 'siniestros'; canal: string }> = [
      { tabla: 'tareas', canal: 'sidebar-tareas' },
      { tabla: 'polizas', canal: 'sidebar-polizas' },
      { tabla: 'siniestros', canal: 'sidebar-siniestros' },
    ]

    const canales = tablas.map(({ tabla, canal }) =>
      supabase
        .channel(canal)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tabla },
          refetchContadores,
        )
        .subscribe(),
    )

    return () => {
      window.removeEventListener('focus', onFocus)
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
      canales.forEach(canal => supabase.removeChannel(canal))
    }
  }, [usuario, cargarContadores, refetchContadores])

  const [perfilUsarLogo, setPerfilUsarLogo] = useState(true)
  useEffect(() => {
    // Fallback inmediato desde localStorage para evitar flash en el primer render.
    setPerfilNombre(localStorage.getItem('crm_perfil_nombre') ?? '')
    setPerfilLogo(localStorage.getItem('crm_perfil_logo') ?? '')
    setPerfilUsarLogo(localStorage.getItem('crm_perfil_usar_logo') !== 'false')

    // Fuente de verdad: tabla configuracion en DB.
    const cargarPerfilDesdeDB = async () => {
      try {
        const supabase = getSupabaseClient()
        const { data } = await supabase
          .from('configuracion')
          .select('nombre, logo_path, usar_logo')
          .maybeSingle()
        if (!data) return
        const nombre = data.nombre ?? ''
        const logo = data.logo_path ?? ''
        const usarLogo = data.usar_logo !== false
        setPerfilNombre(nombre)
        setPerfilLogo(logo)
        setPerfilUsarLogo(usarLogo)
        // Sincronizar localStorage para próximo mount (cache).
        localStorage.setItem('crm_perfil_nombre', nombre)
        localStorage.setItem('crm_perfil_logo', logo)
        localStorage.setItem('crm_perfil_usar_logo', usarLogo ? 'true' : 'false')
      } catch {
        // Si falla la lectura, nos quedamos con el cache de localStorage.
      }
    }
    cargarPerfilDesdeDB()

    // Refresco cross-tab vía storage + intra-tab vía custom event 'perfil-actualizado'.
    const handlerStorage = () => {
      setPerfilNombre(localStorage.getItem('crm_perfil_nombre') ?? '')
      setPerfilLogo(localStorage.getItem('crm_perfil_logo') ?? '')
      setPerfilUsarLogo(localStorage.getItem('crm_perfil_usar_logo') !== 'false')
    }
    const handlerPerfilActualizado = () => { cargarPerfilDesdeDB() }
    window.addEventListener('storage', handlerStorage)
    window.addEventListener('perfil-actualizado', handlerPerfilActualizado)
    return () => {
      window.removeEventListener('storage', handlerStorage)
      window.removeEventListener('perfil-actualizado', handlerPerfilActualizado)
    }
  }, [])

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-30"
      style={{
        width: 'var(--sidebar-width)',
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo / Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--sidebar-border)', height: 'var(--navbar-height)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/branding/pulzar-logo.svg"
          alt="Pulzar"
          className="h-6 w-auto select-none"
          draggable={false}
        />
        <div className="flex items-center gap-1.5">
          {process.env.NEXT_PUBLIC_STACK_LABEL && (
            <span
              className="text-2xs font-mono leading-none px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}
              title={`Stack: ${process.env.NEXT_PUBLIC_STACK_LABEL}`}
            >
              {process.env.NEXT_PUBLIC_STACK_LABEL}
            </span>
          )}
          <Link
            href="/crm/configuracion/actualizaciones"
            className="text-2xs text-slate-500 leading-none hover:text-slate-300 transition-colors"
            title="Ver actualizaciones y novedades"
          >
            v{process.env.NEXT_PUBLIC_APP_VERSION || '?'}
          </Link>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((section) => {
          const visibleItems = section.items.filter(item => !item.modulo || hasAccessTo(item.modulo))
          if (visibleItems.length === 0) return null
          return (
          <div key={section.label} className="mb-1">
            <p className="sidebar-section-label">
              {section.label}
            </p>

            {visibleItems.map((item) => {
              const exactOnly = item.href === '/crm/dashboard' || item.href === '/crm/comercial'
              const isActive = exactOnly
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded text-xs transition-all duration-100',
                    isActive
                      ? 'text-slate-100 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                  style={{
                    backgroundColor: isActive
                      ? 'var(--sidebar-active)'
                      : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  <item.icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
                    )}
                  />
                  <div className="flex flex-col leading-none">
                    <span>{item.label}</span>
                    {'sublabel' in item && item.sublabel && (
                      <span className="text-2xs mt-0.5 text-slate-500">
                        {item.sublabel}
                      </span>
                    )}
                  </div>
                  {item.href === '/crm/tareas' && tareasVencidas > 0 && (
                    <span
                      title={`${tareasVencidas} ${tareasVencidas === 1 ? 'tarea vencida' : 'tareas vencidas'} sin completar`}
                      className="ml-auto flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-2xs font-bold leading-none"
                    >
                      {tareasVencidas}
                    </span>
                  )}
                  {item.href === '/crm/renovaciones' && renovacionesPerdidas > 0 && (
                    <span
                      title={`${renovacionesPerdidas} ${renovacionesPerdidas === 1 ? 'póliza vencida sin renovación' : 'pólizas vencidas sin renovación'} creada`}
                      className="ml-auto flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-2xs font-bold leading-none"
                    >
                      {renovacionesPerdidas}
                    </span>
                  )}
                  {item.href === '/crm/siniestros' && siniestrosSinRevisar > 0 && (
                    <span
                      title={`${siniestrosSinRevisar} ${siniestrosSinRevisar === 1 ? 'denuncia del portal' : 'denuncias del portal'} sin revisar`}
                      className="ml-auto flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-2xs font-bold leading-none"
                    >
                      {siniestrosSinRevisar}
                    </span>
                  )}
                  {isActive && !(
                    (item.href === '/crm/tareas' && tareasVencidas > 0) ||
                    (item.href === '/crm/renovaciones' && renovacionesPerdidas > 0) ||
                    (item.href === '/crm/siniestros' && siniestrosSinRevisar > 0)
                  ) && (
                    <ChevronRight className="ml-auto h-3 w-3 text-slate-500" />
                  )}
                </Link>
              )
            })}
          </div>
          )
        })}
      </nav>

      {/* Footer del sidebar */}
      <div
        className="px-3 py-2.5 border-t"
        style={{ borderColor: 'var(--sidebar-border)' }}
      >
        <div className="flex items-center gap-2">
          {perfilLogo && perfilUsarLogo ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm overflow-hidden">
              <img src={`/api/storage/${perfilLogo}`} alt="Logo"
                className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
              <Building2 className="h-4 w-4 text-slate-500" />
            </div>
          )}
          <div className="flex flex-col leading-none">
            <span className="text-xs text-slate-300 font-medium">
              {perfilNombre || 'Mi Organización'}
            </span>
            <span className="text-2xs text-slate-500">PAS Registrado</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
