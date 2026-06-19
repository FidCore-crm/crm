// ============================================================
// Generador de código único para entradas del catálogo.
//
// El UNIQUE de la tabla `catalogos` es (tipo_id, codigo). El código
// se genera a partir del nombre. Si dos entradas terminan con el
// mismo código autogenerado (ej: nombres distintos que normalizan al
// mismo slug, o edición del nombre que choca con otro existente),
// el INSERT/UPDATE falla con `uq_catalogo_tipo_codigo`.
//
// Este helper garantiza unicidad agregando sufijo `_2`, `_3`... a la
// base si hace falta. Es el mismo patrón que usa el importador masivo
// cuando crea catálogos durante una importación de cartera.
// ============================================================

/**
 * Normaliza un nombre a su slug base. NFD + uppercase + reemplazo de
 * acentos + colapsa whitespace + limita a 20 chars. Es lo mismo que
 * hace la UI vieja, lo encapsulamos acá para tener un solo lugar.
 */
export function slugCatalogo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sacar diacríticos
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '') // solo alfanumérico + espacio + _ + -
    .replace(/\s+/g, '_')
    .slice(0, 20)
}

/**
 * Devuelve un código único para (tipo_id, base). Si la base ya existe
 * para otra entrada del mismo tipo, agrega sufijo `_2`, `_3`...
 *
 * @param supabase  Cliente Supabase (browser o admin sirven).
 * @param nombre    Nombre del catálogo (de ahí se deriva el slug).
 * @param tipo_id   ID del tipo de catálogo (RAMO, COMPANIA, etc.).
 * @param ignorar_id ID de la entrada actual cuando estamos editando.
 *                   Permite que la edición conserve su propio código
 *                   sin auto-colisionar consigo misma.
 */
export async function generarCodigoUnico(
  supabase: any,
  nombre: string,
  tipo_id: string | number,
  ignorar_id?: string,
): Promise<string> {
  const base = slugCatalogo(nombre)
  if (!base) return 'SIN_NOMBRE'

  // Traemos TODOS los códigos del mismo tipo que empiecen con la base.
  // Para un PAS típico son a lo sumo decenas de entradas — barato.
  const { data } = await supabase
    .from('catalogos')
    .select('id, codigo')
    .eq('tipo_id', tipo_id)
    .or(`codigo.eq.${base},codigo.ilike.${base}\\_%`)

  const ocupados = new Set<string>(
    ((data ?? []) as Array<{ id: string; codigo: string | null }>)
      .filter(c => c.id !== ignorar_id) // permitimos reusar nuestro propio código
      .map(c => (c.codigo ?? '').toUpperCase())
      .filter(Boolean)
  )

  if (!ocupados.has(base)) return base

  // Intentar _2, _3, ... hasta encontrar libre. El límite de 100
  // es paranoia — un PAS jamás va a tener 100 ramos con el mismo
  // nombre base.
  for (let n = 2; n <= 100; n++) {
    const candidato = `${base}_${n}`.slice(0, 20)
    if (!ocupados.has(candidato)) return candidato
  }

  // Fallback final: timestamp corto. Casi imposible llegar acá.
  return `${base}_${Date.now().toString().slice(-4)}`.slice(0, 20)
}
