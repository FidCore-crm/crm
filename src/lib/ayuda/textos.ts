/**
 * Catálogo central de textos de ayuda contextual (tooltips inline).
 *
 * Cada entry tiene una `clave` jerárquica (modulo.contexto.elemento) que se
 * usa al renderizar `<AyudaTooltip clave="..."/>` en los componentes. El
 * texto es corto (1-3 oraciones máximo) y se enfoca en el "qué" + "cuándo
 * usar". Para explicaciones largas o procedimientos, el usuario tiene un
 * link al Centro de Ayuda (`/crm/ayuda/<slug>`) — esto lo agregamos como
 * campo opcional `articulo`.
 *
 * Cómo agregar un texto nuevo:
 *   1. Sumar entry acá con clave kebab-case (ej: 'polizas.estado').
 *   2. Usar `<AyudaTooltip clave="polizas.estado" />` en el JSX donde
 *      corresponda.
 *   3. Si el tema merece un artículo completo, agregarlo en
 *      `src/content/ayuda/articulos/` y enlazarlo con el campo `articulo`.
 *
 * Filosofía: los textos viven en código (versionados, tipados, revisables
 * en code review). Si el dueño del producto necesita editarlos sin redeploy,
 * se migran a una tabla DB en una segunda iteración.
 */

export interface TextoAyuda {
  titulo: string
  texto: string
  /** Slug del artículo del Centro de Ayuda relacionado (opcional). */
  articulo?: string
}

export const TEXTOS_AYUDA = {
  // ----- Personas / Clientes -----
  'personas.estado': {
    titulo: 'Estado del cliente',
    texto:
      'PROSPECTO: aún no compró nada (lead frío). ACTIVO: tiene al menos una póliza vigente. INACTIVO: ya no opera. BLOQUEADO: mora, fraude o decisión interna — no se le puede vender más.',
    articulo: 'personas',
  },
  'personas.tipo_persona': {
    titulo: 'Tipo de persona',
    texto:
      'FISICA: una persona humana (con DNI). JURIDICA: empresa, asociación, fideicomiso (con CUIT). Cambia los campos que pide el formulario.',
  },
  'personas.acepta_marketing': {
    titulo: 'Acepta marketing',
    texto:
      'Si está apagado, este cliente NO recibe campañas masivas ni mailings comerciales. Las comunicaciones transaccionales (bienvenida, portal, renovación) siguen llegando — son obligatorias por contrato.',
  },
  'personas.papelera': {
    titulo: 'Papelera de personas',
    texto:
      'Las personas eliminadas quedan acá 30 días por si necesitás recuperarlas. Pasados los 30 días el cron las borra definitivamente junto con sus pólizas, siniestros y archivos.',
  },

  // ----- Pólizas -----
  'polizas.estado': {
    titulo: 'Estados de una póliza',
    texto:
      'PROGRAMADA: fecha de inicio futura. VIGENTE: activa hoy. NO_VIGENTE: venció sin renovación. RENOVADA: latente, espera la fecha de inicio. CANCELADA / ANULADA: dada de baja.',
    articulo: 'polizas',
  },
  'polizas.cancelar_vs_anular': {
    titulo: 'Cancelar vs Anular',
    texto:
      'CANCELAR: baja solicitada por el cliente (cambio de compañía, decisión propia). ANULAR: baja por la compañía (mora, fraude, incumplimiento). Cambia el motivo y queda registrado en la bitácora.',
    articulo: 'polizas',
  },
  'polizas.refacturacion': {
    titulo: 'Refacturación',
    texto:
      'Es la frecuencia con la que el cliente paga la póliza: Mensual, Bimestral, Trimestral, Cuatrimestral, Semestral, Anual o Pago único. Los 7 valores son fijos, no se configuran.',
  },
  'polizas.vigencia': {
    titulo: 'Vigencia',
    texto:
      'La cantidad de meses que dura la póliza, calculada automáticamente desde la fecha de inicio y fin. 12 meses es lo más común. No hace falta seleccionarla — sale sola de las fechas.',
  },
  'polizas.cadena_renovaciones': {
    titulo: 'Cadena de renovaciones',
    texto:
      'Cada vez que renovás, se crea una póliza nueva con número distinto que apunta a la anterior. Las fotos de inspección viven en la primera (raíz); la documentación rota con cada renovación.',
    articulo: 'polizas',
  },
  'polizas.endoso': {
    titulo: 'Endoso',
    texto:
      'Modificación durante la vigencia: cambio de patente, de domicilio, agregar un conductor, sumar suma asegurada. Cada uno se registra con su PDF de respaldo en la sección Endosos.',
  },
  'polizas.rehabilitar': {
    titulo: 'Rehabilitar póliza',
    texto:
      'Disponible solo en pólizas CANCELADA o ANULADA. Calcula automáticamente el estado nuevo según la fecha actual vs la vigencia original. Las renovaciones hijas eliminadas al cancelar NO se restauran.',
  },

  // ----- Siniestros -----
  'siniestros.numero_caso_vs_siniestro': {
    titulo: 'Número de caso vs número de siniestro',
    texto:
      'NÚMERO DE CASO: identificador interno del CRM, se genera al crear (ej: LS-2026-0001). NÚMERO DE SINIESTRO: el que asigna la compañía — se completa después cuando lo tengas, es opcional.',
  },
  'siniestros.estado': {
    titulo: 'Estados de un siniestro',
    texto:
      'DENUNCIADO → INSPECCION → LIQUIDACION → REPARACION → FINALIZADO. RECHAZADO se puede llegar desde cualquier intermedio. FINALIZADO y RECHAZADO son finales — no podés volver atrás.',
    articulo: 'siniestros',
  },
  'siniestros.bitacora': {
    titulo: 'Bitácora del siniestro',
    texto:
      'Registro append-only de todo lo que pasó: cambios de estado, notas internas, archivos. Sirve de respaldo si después hay reclamos o auditoría. Las entradas no se editan ni borran.',
  },

  // ----- Importación -----
  'importar.tipo': {
    titulo: 'Importación inicial vs incremental',
    texto:
      'INICIAL: primera vez que cargás la cartera de una compañía. Crea todo nuevo. INCREMENTAL: actualización periódica — el sistema compara y detecta clientes nuevos, cambios de datos, renovaciones, sin duplicar.',
    articulo: 'importar',
  },
  'importar.dudosos': {
    titulo: 'Registros dudosos',
    texto:
      'Filas donde la IA o las validaciones detectaron problemas: DNIs raros, duplicados, datos inconsistentes. Las revisás una por una y decidís: aceptar, editar, ignorar o actualizar el existente.',
  },

  // ----- Comunicaciones -----
  'comunicaciones.audiencia_tipo': {
    titulo: 'Tipo de audiencia',
    texto:
      'FILTRO: definís criterios (compañía, ramo, vencimiento próximo, etc.) y el sistema arma la lista al momento del envío. MANUAL: elegís personas una por una. Las de tipo FILTRO se actualizan solas en cada campaña.',
    articulo: 'comunicaciones',
  },
  'comunicaciones.campana_estados': {
    titulo: 'Estados de campaña',
    texto:
      'BORRADOR: en edición. PROGRAMADA: espera la fecha. EJECUTANDO: enviando. PAUSADA: detenida, podés retomar. COMPLETADA: terminó. CANCELADA: abortada sin envíos pendientes.',
  },
  'comunicaciones.anti_spam': {
    titulo: 'Anti-spam de envíos',
    texto:
      'Si una persona ya recibió el mismo tipo de email recientemente (bienvenida, renovación), el sistema NO se lo manda de nuevo. Evita duplicados si el cron corre varias veces sobre la misma transición.',
  },

  // ----- Filtros / cartera -----
  'cartera.filtro': {
    titulo: 'Filtro de cartera',
    texto:
      'Si tu acceso es PROPIA, solo ves clientes/pólizas/siniestros que cargaste vos o que tenés asignados. Si es TOTAL, ves todo. El admin decide el acceso de cada usuario en Configuración → Usuarios.',
  },

  // ----- Tareas -----
  'tareas.recurrencia': {
    titulo: 'Tareas recurrentes',
    texto:
      'Al completar una tarea con recurrencia DIARIA/SEMANAL/MENSUAL/ANUAL, el sistema crea automáticamente la próxima con la fecha calculada. Útil para llamados periódicos a clientes clave.',
  },
} as const satisfies Record<string, TextoAyuda>

export type ClaveAyuda = keyof typeof TEXTOS_AYUDA

export function obtenerTextoAyuda(clave: ClaveAyuda): TextoAyuda {
  return TEXTOS_AYUDA[clave]
}
