/**
 * Índice del Centro de Ayuda.
 *
 * Cada artículo es un componente JSX puro en `articulos/<slug>.tsx`.
 * Acá registramos su metadata (título, descripción, ícono, orden) para que
 * la página `/crm/ayuda` los liste correctamente.
 *
 * Cómo agregar un artículo nuevo:
 *   1. Crear `articulos/<slug>.tsx` exportando un componente default.
 *   2. Sumar entry en `ARTICULOS` con su slug + metadata.
 *
 * Los artículos NO requieren parseo: son JSX. El componente padre les pone
 * la tipografía y el espaciado.
 */

import type { ComponentType } from 'react'
import { Rocket, Users, FileText, AlertTriangle, RefreshCw, Mail, Upload } from 'lucide-react'

import PrimerosPasos from './articulos/primeros-pasos'
import Personas from './articulos/personas'
import Polizas from './articulos/polizas'
import Renovaciones from './articulos/renovaciones'
import Siniestros from './articulos/siniestros'
import Importar from './articulos/importar'
import Comunicaciones from './articulos/comunicaciones'

export interface ArticuloAyudaMeta {
  slug: string
  titulo: string
  descripcion: string
  icono: any
  orden: number
  componente: ComponentType
}

export const ARTICULOS: ArticuloAyudaMeta[] = [
  {
    slug: 'primeros-pasos',
    titulo: 'Primeros pasos',
    descripcion: 'Configurar el CRM por primera vez: perfil, SMTP, catálogos y usuarios.',
    icono: Rocket,
    orden: 1,
    componente: PrimerosPasos,
  },
  {
    slug: 'personas',
    titulo: 'Personas y clientes',
    descripcion: 'Cómo gestionar tu cartera: alta, edición, búsqueda y papelera.',
    icono: Users,
    orden: 2,
    componente: Personas,
  },
  {
    slug: 'polizas',
    titulo: 'Pólizas',
    descripcion: 'Estados, cancelar vs anular, cadena de renovaciones, endosos.',
    icono: FileText,
    orden: 3,
    componente: Polizas,
  },
  {
    slug: 'renovaciones',
    titulo: 'Renovaciones',
    descripcion: 'Cómo trabaja el flujo de renovación y qué pasa con los archivos.',
    icono: RefreshCw,
    orden: 4,
    componente: Renovaciones,
  },
  {
    slug: 'siniestros',
    titulo: 'Siniestros',
    descripcion: 'Alta, máquina de estados, bitácora y números (caso vs siniestro).',
    icono: AlertTriangle,
    orden: 5,
    componente: Siniestros,
  },
  {
    slug: 'importar',
    titulo: 'Importar cartera',
    descripcion: 'Importación inicial vs incremental, dudosos y deshacer dentro de 24h.',
    icono: Upload,
    orden: 6,
    componente: Importar,
  },
  {
    slug: 'comunicaciones',
    titulo: 'Comunicaciones',
    descripcion: 'Emails automáticos, plantillas, audiencias y campañas masivas.',
    icono: Mail,
    orden: 7,
    componente: Comunicaciones,
  },
]

export function obtenerArticulo(slug: string): ArticuloAyudaMeta | undefined {
  return ARTICULOS.find((a) => a.slug === slug)
}
