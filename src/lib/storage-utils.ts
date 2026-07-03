import { readdir, rename, unlink, rmdir, mkdir, rm, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

function sanitizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

// ────────────────────────────────────────────────────────────
// Endosos — cada endoso guarda sus archivos en una subcarpeta propia
// identificada por endoso_id dentro de la póliza.
// ────────────────────────────────────────────────────────────

export function getEndosoStoragePath(numeroPoliza: string, endosoId: string): string {
  const numSan = sanitizeName(numeroPoliza)
  const idSan = sanitizeName(endosoId)
  return path.join(STORAGE_ROOT, 'polizas', numSan, 'endosos', idSan)
}

export async function ensureEndosoFolder(numeroPoliza: string, endosoId: string): Promise<void> {
  const folder = getEndosoStoragePath(numeroPoliza, endosoId)
  await mkdir(folder, { recursive: true })
}

export async function deleteEndosoFolder(numeroPoliza: string, endosoId: string): Promise<void> {
  const folder = getEndosoStoragePath(numeroPoliza, endosoId)
  if (folder.startsWith(STORAGE_ROOT) && existsSync(folder)) {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * Transiciona archivos de documentacion_renovada/ a documentacion/
 * cuando una póliza RENOVADA pasa a VIGENTE.
 *
 * Estrategia atómica (copy-then-delete):
 * 1. Copia todos los renovados a un staging path en documentacion/.
 * 2. Si todas las copias fueron exitosas, recién borra los originales y
 *    los archivos viejos de documentacion/. Si alguna copia falla, deshace
 *    el staging y deja el estado original intacto.
 *
 * Esto evita que un fallo a mitad destruya documentación irrecuperable.
 */
export async function transicionarArchivosRenovacion(
  supabase: any,
  numeroPoliza: string,
  polizaOrigenId: string,
  polizaNuevaId: string
): Promise<{ ok: boolean; archivos_movidos: number; error?: string }> {
  const numSan = sanitizeName(numeroPoliza)
  const carpetaRenovada = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion_renovada')
  const carpetaDoc = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion')

  if (!existsSync(carpetaRenovada)) {
    return { ok: true, archivos_movidos: 0 }
  }

  // 1) Listar archivos renovados a mover
  let archivosRenovados: string[] = []
  try {
    archivosRenovados = await readdir(carpetaRenovada)
  } catch (err: any) {
    return { ok: false, archivos_movidos: 0, error: `No se pudo leer carpeta de renovación: ${err.message}` }
  }
  if (archivosRenovados.length === 0) {
    return { ok: true, archivos_movidos: 0 }
  }

  // 2) Asegurar que existe la carpeta destino
  await mkdir(carpetaDoc, { recursive: true })

  // 3) Etapa A: copiar a destino con sufijo .__staging hasta que todas terminen.
  // Si alguna copia falla, limpiamos los staging y devolvemos error sin tocar nada más.
  const staged: string[] = []
  for (const archivo of archivosRenovados) {
    const origen = path.join(carpetaRenovada, archivo)
    const stagingDestino = path.join(carpetaDoc, `${archivo}.__staging`)
    if (!origen.startsWith(STORAGE_ROOT) || !stagingDestino.startsWith(STORAGE_ROOT)) {
      // Path traversal detected: rollback
      for (const s of staged) { try { await unlink(s) } catch { /* ignore */ } }
      return { ok: false, archivos_movidos: 0, error: 'Path inválido' }
    }
    try {
      await copyFile(origen, stagingDestino)
      staged.push(stagingDestino)
    } catch (err: any) {
      for (const s of staged) { try { await unlink(s) } catch { /* ignore */ } }
      return { ok: false, archivos_movidos: 0, error: `Falló copia de ${archivo}: ${err.message}` }
    }
  }

  // 4) Etapa B: borrar archivos viejos de documentacion/ (excepto los staging
  // recién copiados, que matchean por sufijo).
  if (existsSync(carpetaDoc)) {
    try {
      const archivosDoc = await readdir(carpetaDoc)
      for (const archivo of archivosDoc) {
        if (archivo.endsWith('.__staging')) continue // los nuestros, mover después
        const ruta = path.join(carpetaDoc, archivo)
        if (ruta.startsWith(STORAGE_ROOT)) {
          try { await unlink(ruta) } catch { /* puede no existir */ }
        }
      }
    } catch { /* no crítico */ }
  }

  // 5) Promover staging → nombre final.
  // Si algún rename falla, no borramos nada de DB todavía: los originales
  // siguen en documentacion_renovada/ y las filas de DB intactas → reintento posible.
  let movidos = 0
  const renameFallidos: string[] = []
  for (const stagingPath of staged) {
    const finalPath = stagingPath.replace(/\.__staging$/, '')
    try {
      await rename(stagingPath, finalPath)
      movidos++
    } catch (err: any) {
      renameFallidos.push(`${path.basename(stagingPath)}: ${err.message}`)
      try { await unlink(stagingPath) } catch { /* ignore */ }
    }
  }

  if (renameFallidos.length > 0) {
    return {
      ok: false,
      archivos_movidos: movidos,
      error: `Falló al promover staging: ${renameFallidos.join('; ')}`,
    }
  }

  // 6) Solo después de promover los archivos exitosamente actualizamos la DB:
  //    - borrar registros de la origen
  //    - actualizar los registros de la nueva (categoria + ruta)
  await supabase
    .from('poliza_archivos')
    .delete()
    .eq('poliza_id', polizaOrigenId)
    .eq('categoria', 'documentacion')

  const { data: registros } = await supabase
    .from('poliza_archivos')
    .select('id, ruta, nombre')
    .eq('poliza_id', polizaNuevaId)
    .eq('categoria', 'documentacion_renovada')

  if (registros && registros.length > 0) {
    // Antes de marcar el nuevo PDF como principal, desmarcamos cualquier otro
    // archivo principal de esta póliza (defensivo — no debería existir).
    await supabase
      .from('poliza_archivos')
      .update({ es_poliza_principal: false } as any)
      .eq('poliza_id', polizaNuevaId)
      .eq('es_poliza_principal', true)

    for (let i = 0; i < registros.length; i++) {
      const reg = registros[i]
      const nuevaRuta = (reg.ruta as string).replace('documentacion_renovada', 'documentacion')
      // Solo el primer archivo de la renovación se marca como principal —
      // si hay varios PDFs adjuntos en la renovación (raro), el primero
      // representa la póliza. El comparador de la próxima renovación tomará
      // ese como referencia.
      const esPrincipal = i === 0
      await supabase
        .from('poliza_archivos')
        .update({ categoria: 'documentacion', ruta: nuevaRuta, es_poliza_principal: esPrincipal } as any)
        .eq('id', reg.id)
    }
  }

  // 7) Borrar los originales en documentacion_renovada/. Estos archivos ya están
  // copiados a documentacion/ con éxito, así que es seguro borrarlos.
  for (const archivo of archivosRenovados) {
    const ruta = path.join(carpetaRenovada, archivo)
    if (ruta.startsWith(STORAGE_ROOT)) {
      try { await unlink(ruta) } catch { /* ya pudo haberse rename'd antes */ }
    }
  }

  // 8) Intentar eliminar carpeta documentacion_renovada si quedó vacía
  try {
    const restantes = await readdir(carpetaRenovada)
    if (restantes.length === 0) {
      await rmdir(carpetaRenovada)
    }
  } catch {
    // Ignorar si no se puede eliminar
  }

  return { ok: true, archivos_movidos: movidos }
}

/**
 * Recorre la cadena de hijas a partir de una póliza origen y devuelve la lista
 * completa de pólizas RENOVADAS encontradas (latentes que cuelgan de origen).
 * Incluye nietas, bisnietas, etc., con guard anti-ciclo. Útil para limpiar
 * recursivamente al cancelar/anular una póliza.
 */
export async function obtenerCadenaHijasRenovadas(
  supabase: any,
  origenId: string,
): Promise<Array<{ id: string; numero_poliza: string }>> {
  const resultado: Array<{ id: string; numero_poliza: string }> = []
  const visitados = new Set<string>([origenId])
  const cola: string[] = [origenId]

  while (cola.length > 0) {
    const currentId = cola.shift()!
    const { data: hijas } = await supabase
      .from('polizas')
      .select('id, numero_poliza, estado')
      .eq('poliza_origen_id', currentId)
    for (const h of (hijas ?? []) as Array<{ id: string; numero_poliza: string; estado: string }>) {
      if (visitados.has(h.id)) continue
      visitados.add(h.id)
      if (h.estado === 'RENOVADA') {
        // Es una renovación latente que pertenece a la origen que se está
        // cancelando/anulando — sí la incluimos y seguimos descendiendo por
        // si tiene sus propias RENOVADAs encadenadas (poco común, pero válido).
        resultado.push({ id: h.id, numero_poliza: h.numero_poliza })
        cola.push(h.id)
      }
      // Si la hija está VIGENTE / NO_VIGENTE / CANCELADA / ANULADA, NO descendemos.
      // Una RENOVADA bajo una hija VIGENTE pertenece a ESA hija, no al ancestro
      // que se está dando de baja — descender la borraría incorrectamente.
    }
  }

  return resultado
}

/**
 * Elimina archivos de una póliza RENOVADA (latente) que se descarta
 * porque la póliza origen fue cancelada o anulada.
 * Limpia documentacion_renovada/ y los registros en poliza_archivos.
 */
export async function eliminarArchivosRenovacionLatente(
  supabase: any,
  numeroPoliza: string,
  polizaRenovadaId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const numSan = sanitizeName(numeroPoliza)
    const carpetaRenovada = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion_renovada')

    // Eliminar archivos físicos de documentacion_renovada/
    if (existsSync(carpetaRenovada)) {
      const archivos = await readdir(carpetaRenovada)
      for (const archivo of archivos) {
        const ruta = path.join(carpetaRenovada, archivo)
        if (ruta.startsWith(STORAGE_ROOT)) {
          await unlink(ruta)
        }
      }
      try { await rmdir(carpetaRenovada) } catch { /* ignorar */ }
    }

    // Eliminar todos los registros de poliza_archivos de la póliza renovada
    await supabase
      .from('poliza_archivos')
      .delete()
      .eq('poliza_id', polizaRenovadaId)

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

/**
 * Limpia documentacion/ de una póliza que pasa a NO_VIGENTE sin renovación.
 * Nunca toca inspeccion/ ni documentacion_renovada/.
 */
export async function limpiarDocumentacion(
  supabase: any,
  numeroPoliza: string,
  polizaId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const numSan = sanitizeName(numeroPoliza)
    const carpetaDoc = path.join(STORAGE_ROOT, 'polizas', numSan, 'documentacion')

    // Eliminar archivos físicos
    if (existsSync(carpetaDoc)) {
      const archivos = await readdir(carpetaDoc)
      for (const archivo of archivos) {
        const ruta = path.join(carpetaDoc, archivo)
        if (ruta.startsWith(STORAGE_ROOT)) {
          await unlink(ruta)
        }
      }
    }

    // Eliminar registros de poliza_archivos
    await supabase
      .from('poliza_archivos')
      .delete()
      .eq('poliza_id', polizaId)
      .eq('categoria', 'documentacion')

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}
