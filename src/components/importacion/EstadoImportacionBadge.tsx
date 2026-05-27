import {
  Clock,
  Loader2,
  ClipboardList,
  AlertTriangle,
  CheckCircle,
  XCircle,
  X,
  Pause,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  estado: string;
  size?: 'sm' | 'md';
}

interface BadgeConfig {
  icon: LucideIcon;
  label: string;
  classes: string;
  spin?: boolean;
}

const MAP: Record<string, BadgeConfig> = {
  PENDIENTE: {
    icon: Clock,
    label: 'Pendiente',
    classes: 'bg-slate-50 text-slate-700 border-slate-200',
  },
  ANALIZANDO: {
    icon: Loader2,
    label: 'Analizando',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    spin: true,
  },
  ANALIZADO: {
    icon: ClipboardList,
    label: 'Listo para revisar',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  IMPORTANDO: {
    icon: Loader2,
    label: 'Procesando',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    spin: true,
  },
  REVISANDO: {
    icon: AlertTriangle,
    label: 'Requiere revisión',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  COMPLETADA: {
    icon: CheckCircle,
    label: 'Completada',
    classes: 'bg-green-50 text-green-700 border-green-200',
  },
  FALLIDA: {
    icon: XCircle,
    label: 'Fallida',
    classes: 'bg-red-50 text-red-700 border-red-200',
  },
  CANCELADA: {
    icon: X,
    label: 'Cancelada',
    classes: 'bg-slate-50 text-slate-700 border-slate-200',
  },
  PAUSADA: {
    icon: Pause,
    label: 'Pausada',
    classes: 'bg-orange-50 text-orange-700 border-orange-200',
  },
};

export function EstadoImportacionBadge({ estado, size = 'md' }: Props) {
  const cfg = MAP[estado] || {
    icon: Clock,
    label: estado,
    classes: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  const Icon = cfg.icon;

  const sizeClasses =
    size === 'sm'
      ? 'text-2xs px-1.5 py-0.5'
      : 'text-xs px-2 py-0.5';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <span
      className={`${sizeClasses} font-semibold rounded border inline-flex items-center gap-1 ${cfg.classes}`}
    >
      <Icon className={`${iconSize} ${cfg.spin ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}
