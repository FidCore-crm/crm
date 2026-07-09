/**
 * Aclaraciones default de cotización — módulo puro (sin dependencias externas)
 *
 * Vive separado de `pdf-cotizacion.ts` para que pantallas cliente (como
 * `/crm/configuracion/perfil`) puedan importar la constante sin arrastrar
 * jsPDF al bundle del browser.
 *
 * Formato: cada punto es un párrafo separado por línea en blanco. El
 * renderer del PDF (ver `parsearAclaraciones` en `pdf-cotizacion.ts`) los
 * divide por eso y los muestra como bloques individuales.
 */

export const ACLARACIONES_COTIZACION_DEFAULT: string[] = [
  'Se deja expresa constancia que las sumas informadas para cotizar, al momento de la emisión pueden ser adecuadas por la compañía de seguros.',
  'El otorgamiento de la cobertura quedará sujeto al resultado de la inspección previa satisfactoria de la/s unidad/es, de corresponder. La cobertura cotizada podrá sufrir modificaciones en base al resultado de la inspección.',
  'La presente cotización se encuentra sujeta a las condiciones generales y particulares de la póliza aprobadas por la Superintendencia de Seguros de la Nación.',
  'Esta propuesta no constituye una cobertura de seguros sino una cotización de la misma, y tiene validez por un plazo determinado. Después de dicha fecha la/s Aseguradoras podrán retirar o modificar los términos previamente ofertados.',
  'Los costos indicados precedentemente corresponden al período de vigencia de cobertura informado.',
  'Inspección previa: si la cobertura seleccionada requiere inspección previa, recuerde que hasta tanto no cumpla con dicho trámite la póliza no será emitida por la Aseguradora.',
  'Instalación de dispositivo de rastreo satelital: las aseguradoras podrán exigir la instalación de un dispositivo de rastreo, cuyo costo de instalación y abono por servicio estará a cargo del asegurado. Consulte alcances y condiciones.',
  'Esta cotización está basada en la información suministrada por ustedes, por lo que si considera que existen variaciones que puedan modificar el riesgo la cotización podría variar.',
  'Para mayor información, comuníquese con nosotros por cualquiera de nuestros canales de atención.',
]

export const ACLARACIONES_COTIZACION_DEFAULT_TEXTO: string =
  ACLARACIONES_COTIZACION_DEFAULT.join('\n\n')
