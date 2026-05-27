// ============================================================
// Validación de datos extraídos por la IA + detección de dudosos
// Reutiliza los validadores del importador.
// ============================================================

import { validarDNI, validarCUIT, validarEmail, validarFecha } from '@/lib/importacion/validators'
import type {
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  MapeosCatalogos,
  CampoDudoso,
  TipoOperacionPDF,
} from './types'

export function validarDatosExtraidosPoliza(
  datos: DatosExtraidosPoliza,
  mapeos: MapeosCatalogos,
  tipoOperacion: TipoOperacionPDF,
  contexto?: { poliza_origen_dni_cuil?: string; poliza_origen_numero?: string }
): CampoDudoso[] {
  const dudosos: CampoDudoso[] = []

  // ── Asegurado ──
  const dni = datos.asegurado?.dni_cuil
  if (!dni) {
    dudosos.push({
      campo: 'asegurado.dni_cuil',
      tipo_problema: 'DNI_FALTANTE',
      valor_extraido: null,
      motivo: 'No se encontró DNI/CUIT del asegurado en el PDF',
    })
  } else {
    const esJuridica = datos.asegurado?.tipo_persona === 'JURIDICA'
    const v = esJuridica ? validarCUIT(dni) : validarDNI(dni)
    if (!v.valido) {
      // Si DNI falla, probar con CUIT (a veces la IA confunde)
      const vc = validarCUIT(dni)
      if (!vc.valido) {
        dudosos.push({
          campo: 'asegurado.dni_cuil',
          tipo_problema: 'DNI_INVALIDO',
          valor_extraido: dni,
          motivo: v.motivo || 'Documento inválido',
        })
      }
    }
  }

  if (datos.asegurado?.email) {
    const ve = validarEmail(datos.asegurado.email)
    if (!ve.valido) {
      dudosos.push({
        campo: 'asegurado.email',
        tipo_problema: 'EMAIL_INVALIDO',
        valor_extraido: datos.asegurado.email,
        motivo: 'Email con formato inválido',
      })
    }
  }

  // ── Póliza ──
  const fi = datos.poliza?.fecha_inicio
  const ff = datos.poliza?.fecha_fin
  if (!fi) {
    dudosos.push({
      campo: 'poliza.fecha_inicio',
      tipo_problema: 'FECHA_INVALIDA',
      valor_extraido: null,
      motivo: 'Fecha de inicio no detectada',
    })
  } else {
    const vf = validarFecha(fi)
    if (!vf.valido) {
      dudosos.push({
        campo: 'poliza.fecha_inicio',
        tipo_problema: 'FECHA_INVALIDA',
        valor_extraido: fi,
        motivo: vf.motivo || 'Fecha inválida',
      })
    }
  }
  if (!ff) {
    dudosos.push({
      campo: 'poliza.fecha_fin',
      tipo_problema: 'FECHA_INVALIDA',
      valor_extraido: null,
      motivo: 'Fecha de fin no detectada',
    })
  } else {
    const vf = validarFecha(ff)
    if (!vf.valido) {
      dudosos.push({
        campo: 'poliza.fecha_fin',
        tipo_problema: 'FECHA_INVALIDA',
        valor_extraido: ff,
        motivo: vf.motivo || 'Fecha inválida',
      })
    }
  }
  if (fi && ff) {
    const di = new Date(fi).getTime()
    const df = new Date(ff).getTime()
    if (!isNaN(di) && !isNaN(df) && df <= di) {
      dudosos.push({
        campo: 'poliza.vigencia',
        tipo_problema: 'INCONSISTENCIA_LOGICA',
        valor_extraido: `${fi} → ${ff}`,
        motivo: 'La fecha de fin es anterior o igual a la fecha de inicio',
      })
    }
  }

  if (!datos.poliza?.numero_poliza) {
    dudosos.push({
      campo: 'poliza.numero_poliza',
      tipo_problema: 'DATOS_FALTANTES',
      valor_extraido: null,
      motivo: 'No se detectó el número de póliza',
    })
  }

  // ── Catálogos ──
  if (!mapeos.compania_id) {
    dudosos.push({
      campo: 'mapeos.compania',
      tipo_problema: 'COMPANIA_NO_RECONOCIDA',
      valor_extraido: mapeos.compania_propuesta || datos.catalogos_pdf?.compania_texto || null,
      motivo: 'La compañía del PDF no coincide con ninguna del catálogo del CRM',
      sugerencia: mapeos.compania_propuesta || undefined,
    })
  }
  if (!mapeos.ramo_id) {
    dudosos.push({
      campo: 'mapeos.ramo',
      tipo_problema: 'RAMO_NO_RECONOCIDO',
      valor_extraido: mapeos.ramo_propuesto || datos.catalogos_pdf?.ramo_texto || null,
      motivo: 'El ramo del PDF no coincide con ninguno del catálogo',
      sugerencia: mapeos.ramo_propuesto || undefined,
    })
  }
  if (!mapeos.cobertura_id) {
    const info = mapeos.cobertura_info_config
    const esBloqueante = mapeos.cobertura_estado === 'REQUIERE_CONFIGURACION'
    dudosos.push({
      campo: 'mapeos.cobertura',
      tipo_problema: 'COBERTURA_NO_RECONOCIDA',
      valor_extraido: info?.texto_pdf || mapeos.cobertura_propuesta || datos.catalogos_pdf?.cobertura_texto || null,
      motivo: esBloqueante
        ? 'COBERTURA_NO_CONFIGURADA'
        : 'La cobertura del PDF no coincide con ninguna del catálogo',
      sugerencia: info?.sugerencia_accion || mapeos.cobertura_propuesta || undefined,
      bloqueante: esBloqueante,
    })
  }

  // ── Riesgo ──
  if (!datos.riesgo?.tipo_riesgo) {
    dudosos.push({
      campo: 'riesgo.tipo_riesgo',
      tipo_problema: 'RIESGO_INCOMPLETO',
      valor_extraido: null,
      motivo: 'No se detectó el tipo de riesgo',
    })
  } else if (String(datos.riesgo.tipo_riesgo).toUpperCase() === 'AUTOMOTOR') {
    const dt = datos.riesgo.detalle_tecnico || {}
    if (!dt.patente && !dt.chasis) {
      dudosos.push({
        campo: 'riesgo.automotor',
        tipo_problema: 'RIESGO_INCOMPLETO',
        valor_extraido: null,
        motivo: 'No se detectó patente ni chasis del vehículo',
      })
    }
  }

  // ── Validaciones cruzadas con póliza origen (renovación) ──
  if (tipoOperacion === 'RENOVACION' && contexto) {
    if (
      contexto.poliza_origen_dni_cuil &&
      dni &&
      contexto.poliza_origen_dni_cuil.replace(/\D/g, '') !== String(dni).replace(/\D/g, '')
    ) {
      dudosos.push({
        campo: 'asegurado.dni_cuil',
        tipo_problema: 'ASEGURADO_DIFERENTE_A_ORIGEN',
        valor_extraido: String(dni),
        motivo: `El DNI del PDF (${dni}) no coincide con el de la póliza origen (${contexto.poliza_origen_dni_cuil})`,
      })
    }
    if (
      contexto.poliza_origen_numero &&
      datos.poliza?.numero_poliza &&
      contexto.poliza_origen_numero === datos.poliza.numero_poliza
    ) {
      dudosos.push({
        campo: 'poliza.numero_poliza',
        tipo_problema: 'NUMERO_POLIZA_DUPLICADO',
        valor_extraido: datos.poliza.numero_poliza,
        motivo: 'El número de póliza nuevo coincide con el de la póliza origen',
      })
    }
  }

  return dudosos
}

export function validarDatosExtraidosEndoso(
  datos: DatosExtraidosEndoso
): CampoDudoso[] {
  const dudosos: CampoDudoso[] = []

  if (!datos.motivo || !datos.motivo.trim()) {
    dudosos.push({
      campo: 'motivo',
      tipo_problema: 'DATOS_FALTANTES',
      valor_extraido: null,
      motivo: 'No se detectó el motivo del endoso',
    })
  }

  if (datos.fecha_endoso) {
    const v = validarFecha(datos.fecha_endoso)
    if (!v.valido) {
      dudosos.push({
        campo: 'fecha_endoso',
        tipo_problema: 'FECHA_INVALIDA',
        valor_extraido: datos.fecha_endoso,
        motivo: v.motivo || 'Fecha inválida',
      })
    }
  }

  return dudosos
}
