export default function Siniestros() {
  return (
    <>
      <h2>Número de caso vs número de siniestro</h2>
      <p>
        FidCore usa dos números distintos para identificar siniestros:
      </p>
      <ul>
        <li>
          <strong>Número de caso</strong> — el identificador interno del CRM. Se genera automáticamente al crear el siniestro (ej: <code>LS-2026-0001</code>) usando el prefijo que configurás en Perfil. Es inmutable.
        </li>
        <li>
          <strong>Número de siniestro</strong> — el que asigna la compañía aseguradora. <strong>Es opcional</strong> y lo cargás después, cuando la compañía lo informa. Lo editás desde la ficha.
        </li>
      </ul>
      <p>
        En las búsquedas podés usar cualquiera de los dos.
      </p>

      <h2>Máquina de estados</h2>
      <p>
        Un siniestro pasa por varios estados durante su gestión. Las transiciones permitidas son:
      </p>
      <ol>
        <li><strong>DENUNCIADO</strong> — recién cargado.</li>
        <li><strong>INSPECCION</strong> — el perito está revisando.</li>
        <li><strong>LIQUIDACION</strong> — se está armando el cálculo del pago.</li>
        <li><strong>REPARACION</strong> — se está reparando el bien (si aplica).</li>
        <li><strong>FINALIZADO</strong> — caso cerrado con pago/reparación.</li>
      </ol>
      <p>
        <strong>RECHAZADO</strong> se puede llegar desde cualquier estado intermedio. FINALIZADO y RECHAZADO son <strong>finales</strong>: no podés volver atrás. El sistema solo te muestra los estados a los que sí podés transicionar.
      </p>

      <h2>Bitácora del siniestro</h2>
      <p>
        Todo lo que pasa con un siniestro queda en la bitácora: cambios de estado, notas internas, archivos subidos, edición de montos. Es <strong>append-only</strong> (no se edita ni se borra) — sirve de respaldo legal si después hay un reclamo o auditoría.
      </p>

      <h2>Archivos y carpetas</h2>
      <p>
        Cada siniestro tiene dos carpetas en disco para sus archivos:
      </p>
      <ul>
        <li><strong>fotos</strong> — imágenes del daño, del lugar, fotos del cliente.</li>
        <li><strong>documentacion</strong> — denuncia firmada, peritajes, presupuestos, fact. de reparación.</li>
      </ul>
      <p>
        Las carpetas en el disco usan el <strong>número de caso</strong> (no el de siniestro de la compañía), porque el número de caso es inmutable.
      </p>

      <h2>Eliminar siniestros</h2>
      <p>
        Igual que personas: los siniestros eliminados van a la <strong>papelera</strong> durante 30 días. Pasados los 30 días el proceso automático borra el siniestro y todos sus archivos del disco. Si lo necesitás recuperar dentro de la ventana, andá a "Papelera" desde el listado.
      </p>
    </>
  )
}
