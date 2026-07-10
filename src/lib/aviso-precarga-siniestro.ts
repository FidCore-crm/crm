/**
 * Aviso único compartido entre las 3 superficies que ve el asegurado tras
 * cargar una denuncia por el formulario público / portal del asegurado:
 *   1. Splash de éxito del formulario /denuncia
 *   2. Email de confirmación al asegurado
 *   3. PDF de la denuncia (Denuncia_{numero_caso}.pdf)
 *
 * El objetivo es dejar en claro que la carga en el CRM NO es la denuncia
 * formal ante la aseguradora — sino un aviso al productor, que es quien
 * la eleva. Evita que el asegurado suponga que ya cumplió con el plazo.
 */

export const AVISO_PRECARGA_TITULO = '¡Importante!'

export const AVISO_PRECARGA_TEXTO =
  'Avisale a tu productor sobre esta pre-carga para que pueda elevar la denuncia administrativa a la compañía.'
