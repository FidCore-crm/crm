/**
 * Catálogo central de códigos de error del CRM.
 *
 * Convención: ERR_<CATEGORIA>_<NNN>
 *
 * Categorías:
 * - AUTH:  autenticación / sesión
 * - PERM:  permisos / autorización
 * - VALID: validación de datos de entrada
 * - DB:    base de datos
 * - EXT:   servicios externos (SMTP, IA, Drive, etc.)
 * - NEG:   reglas de negocio
 * - SYS:   errores internos del sistema
 *
 * Cada código tiene:
 * - mensaje:           técnico / corto / mostrable. Es lo que devuelve la API
 *                      en el campo `error.mensaje` (retrocompat).
 * - mensaje_humano:    texto pensado para que lea el PAS sin tecnicismos.
 *                      Lo usan los toasts del frontend, la pantalla de
 *                      errores-sistema y la plantilla del email crítico.
 * - sugerencia:        qué puede hacer el usuario. Acompaña al mensaje humano.
 *                      Si la sugerencia depende del contexto, dejarla genérica.
 * - categoria_humana:  agrupador legible en la UI ("Sesión", "Validación", etc.).
 * - status_http:       código HTTP por defecto cuando se usa en API routes.
 * - es_critico:        si true, se persiste en errores_sistema y notifica al admin.
 */

export interface DefinicionError {
  codigo: string
  mensaje: string
  mensaje_humano: string
  sugerencia: string
  categoria_humana: string
  status_http: number
  es_critico: boolean
}

export const ERRORES = {
  // ===== AUTH (autenticación / sesión) =====
  AUTH_SESION_EXPIRADA: {
    codigo: 'ERR_AUTH_001',
    mensaje: 'Tu sesión expiró. Iniciá sesión de nuevo.',
    mensaje_humano: 'Tu sesión expiró',
    sugerencia: 'Iniciá sesión de nuevo para continuar.',
    categoria_humana: 'Sesión',
    status_http: 401,
    es_critico: false,
  },
  AUTH_TOKEN_INVALIDO: {
    codigo: 'ERR_AUTH_002',
    mensaje: 'No estás autenticado. Iniciá sesión para continuar.',
    mensaje_humano: 'No estás autenticado',
    sugerencia: 'Iniciá sesión para continuar.',
    categoria_humana: 'Sesión',
    status_http: 401,
    es_critico: false,
  },
  AUTH_CREDENCIALES_INVALIDAS: {
    codigo: 'ERR_AUTH_003',
    mensaje: 'Email o contraseña incorrectos.',
    mensaje_humano: 'Email o contraseña incorrectos',
    sugerencia: 'Verificá los datos e intentá de nuevo.',
    categoria_humana: 'Sesión',
    status_http: 401,
    es_critico: false,
  },

  // ===== PERM (permisos / autorización) =====
  PERM_SIN_PERMISO: {
    codigo: 'ERR_PERM_001',
    mensaje: 'No tenés permisos para realizar esta acción.',
    mensaje_humano: 'No tenés permisos para esta acción',
    sugerencia: 'Contactá al administrador del sistema si necesitás acceso.',
    categoria_humana: 'Permisos',
    status_http: 403,
    es_critico: false,
  },
  PERM_RECURSO_AJENO: {
    codigo: 'ERR_PERM_002',
    mensaje: 'No podés acceder a este recurso.',
    mensaje_humano: 'No podés acceder a este recurso',
    sugerencia: 'Solo el dueño del registro puede verlo o editarlo.',
    categoria_humana: 'Permisos',
    status_http: 403,
    es_critico: false,
  },

  // ===== VALID (validación de inputs) =====
  VALID_CAMPO_REQUERIDO: {
    codigo: 'ERR_VALID_001',
    mensaje: 'Faltan datos obligatorios.',
    mensaje_humano: 'Faltan datos obligatorios',
    sugerencia: 'Completá los campos marcados antes de continuar.',
    categoria_humana: 'Validación',
    status_http: 400,
    es_critico: false,
  },
  VALID_FORMATO_INVALIDO: {
    codigo: 'ERR_VALID_002',
    mensaje: 'El formato de los datos no es válido.',
    mensaje_humano: 'El formato de los datos no es válido',
    sugerencia: 'Revisá el formato de los campos resaltados (ej: emails, fechas, DNI).',
    categoria_humana: 'Validación',
    status_http: 400,
    es_critico: false,
  },
  VALID_VALOR_FUERA_DE_RANGO: {
    codigo: 'ERR_VALID_003',
    mensaje: 'Algunos valores están fuera del rango permitido.',
    mensaje_humano: 'Algunos valores están fuera del rango permitido',
    sugerencia: 'Verificá que los valores estén dentro de los límites esperados.',
    categoria_humana: 'Validación',
    status_http: 400,
    es_critico: false,
  },

  // ===== DB (base de datos) =====
  DB_NO_DISPONIBLE: {
    codigo: 'ERR_DB_001',
    mensaje: 'No se pudo conectar con la base de datos. Intentá de nuevo en unos minutos.',
    mensaje_humano: 'No se pudo conectar con la base de datos',
    sugerencia: 'Intentá de nuevo en unos minutos. Si persiste, avisá a soporte.',
    categoria_humana: 'Base de datos',
    status_http: 503,
    es_critico: true,
  },
  DB_REGISTRO_NO_ENCONTRADO: {
    codigo: 'ERR_DB_002',
    mensaje: 'El registro solicitado no existe.',
    mensaje_humano: 'El registro solicitado no existe',
    sugerencia: 'Puede haber sido eliminado. Refrescá la lista.',
    categoria_humana: 'Base de datos',
    status_http: 404,
    es_critico: false,
  },
  DB_REGISTRO_DUPLICADO: {
    codigo: 'ERR_DB_003',
    mensaje: 'Ya existe un registro con esos datos.',
    mensaje_humano: 'Ya existe un registro con esos datos',
    sugerencia: 'Buscá el registro existente o usá un identificador diferente.',
    categoria_humana: 'Base de datos',
    status_http: 409,
    es_critico: false,
  },
  DB_ERROR_ESCRITURA: {
    codigo: 'ERR_DB_004',
    mensaje: 'No se pudo guardar la información. Intentá de nuevo.',
    mensaje_humano: 'No se pudo guardar la información',
    sugerencia: 'Intentá de nuevo. Si persiste, contactá a soporte.',
    categoria_humana: 'Base de datos',
    status_http: 500,
    es_critico: true,
  },

  // ===== EXT (servicios externos) =====
  EXT_SMTP_NO_DISPONIBLE: {
    codigo: 'ERR_EXT_001',
    mensaje: 'El servidor de correo no está disponible. El email no se pudo enviar.',
    mensaje_humano: 'El servidor de correo no está disponible',
    sugerencia: 'El email no se envió. Probá la configuración SMTP en Configuración → Correos.',
    categoria_humana: 'Correos',
    status_http: 503,
    es_critico: true,
  },
  EXT_IA_NO_DISPONIBLE: {
    codigo: 'ERR_EXT_002',
    mensaje: 'El servicio de IA no está disponible. Intentá más tarde.',
    mensaje_humano: 'El servicio de IA no está disponible',
    sugerencia: 'Verificá la API key en Configuración → Agente IA o intentá más tarde.',
    categoria_humana: 'Servicios externos',
    status_http: 503,
    es_critico: true,
  },
  EXT_DRIVE_NO_DISPONIBLE: {
    codigo: 'ERR_EXT_003',
    mensaje: 'No se pudo conectar con Google Drive.',
    mensaje_humano: 'No se pudo conectar con Google Drive',
    sugerencia: 'Verificá la configuración de rclone en el servidor.',
    categoria_humana: 'Servicios externos',
    status_http: 503,
    es_critico: true,
  },
  EXT_STORAGE_NO_DISPONIBLE: {
    codigo: 'ERR_EXT_004',
    mensaje: 'No se pudo acceder al almacenamiento de archivos.',
    mensaje_humano: 'No se pudo acceder al almacenamiento de archivos',
    sugerencia: 'Verificá los permisos de la carpeta storage/ en el servidor.',
    categoria_humana: 'Almacenamiento',
    status_http: 503,
    es_critico: true,
  },

  // ===== NEG (reglas de negocio) =====
  NEG_POLIZA_DUPLICADA: {
    codigo: 'ERR_NEG_001',
    mensaje: 'Ya existe una póliza con ese número.',
    mensaje_humano: 'Ya existe una póliza con ese número',
    sugerencia: 'Verificá el número o buscá la póliza existente en el listado.',
    categoria_humana: 'Operación inválida',
    status_http: 409,
    es_critico: false,
  },
  NEG_OPERACION_INVALIDA: {
    codigo: 'ERR_NEG_002',
    mensaje: 'No se puede realizar esta operación en el estado actual.',
    mensaje_humano: 'No se puede realizar esta operación en el estado actual',
    sugerencia: 'Revisá el estado del registro antes de continuar.',
    categoria_humana: 'Operación inválida',
    status_http: 422,
    es_critico: false,
  },
  NEG_LIMITE_EXCEDIDO: {
    codigo: 'ERR_NEG_003',
    mensaje: 'Excede el límite permitido.',
    mensaje_humano: 'Excede el límite permitido',
    sugerencia: 'Reducí la cantidad o el tamaño antes de continuar.',
    categoria_humana: 'Operación inválida',
    status_http: 422,
    es_critico: false,
  },
  NEG_CONFLICTO_CONCURRENCIA: {
    codigo: 'ERR_NEG_004',
    mensaje: 'El registro fue modificado por otro usuario mientras lo editabas.',
    mensaje_humano: 'Otro usuario editó este registro mientras vos lo estabas modificando',
    sugerencia: 'Recargá la ficha para ver los cambios y volver a aplicar los tuyos, o sobreescribir igual.',
    categoria_humana: 'Conflicto de edición',
    status_http: 409,
    es_critico: false,
  },

  // ===== SYS (errores internos no clasificados) =====
  SYS_ERROR_INTERNO: {
    codigo: 'ERR_SYS_001',
    mensaje: 'Ocurrió un error inesperado. Si persiste, contactá a soporte.',
    mensaje_humano: 'Ocurrió un error inesperado',
    sugerencia: 'Intentá de nuevo. Si persiste, contactá a soporte con el código y la fecha.',
    categoria_humana: 'Sistema',
    status_http: 500,
    es_critico: true,
  },
  SYS_TIMEOUT: {
    codigo: 'ERR_SYS_002',
    mensaje: 'La operación tardó demasiado y fue cancelada.',
    mensaje_humano: 'La operación tardó demasiado y fue cancelada',
    sugerencia: 'Intentá de nuevo con menos datos o más tarde.',
    categoria_humana: 'Sistema',
    status_http: 504,
    es_critico: false,
  },
  SYS_RATE_LIMIT: {
    codigo: 'ERR_SYS_003',
    mensaje: 'Hiciste demasiadas solicitudes. Esperá unos segundos.',
    mensaje_humano: 'Hiciste demasiadas solicitudes',
    sugerencia: 'Esperá unos segundos antes de intentar de nuevo.',
    categoria_humana: 'Sistema',
    status_http: 429,
    es_critico: false,
  },
} as const satisfies Record<string, DefinicionError>

export type ClaveError = keyof typeof ERRORES
export type CodigoError = (typeof ERRORES)[ClaveError]['codigo']

/**
 * Map por código (ej: "ERR_DB_001") → DefinicionError. Útil cuando se tiene
 * un código guardado en DB y se quiere recuperar el mensaje humano + sugerencia
 * + categoría sin tener que iterar todo el catálogo.
 */
const POR_CODIGO: Record<string, DefinicionError> = Object.fromEntries(
  Object.values(ERRORES).map((def) => [def.codigo, def]),
)

/**
 * Devuelve la `DefinicionError` para un código dado, o `null` si no se conoce
 * (puede pasar con códigos legacy guardados en DB que ya no existen en el catálogo).
 */
export function obtenerDefinicionPorCodigo(codigo: string): DefinicionError | null {
  return POR_CODIGO[codigo] ?? null
}
