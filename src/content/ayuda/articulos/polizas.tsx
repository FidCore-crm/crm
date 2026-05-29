export default function Polizas() {
  return (
    <>
      <h2>Estados de una póliza</h2>
      <p>
        El estado refleja en qué punto de su ciclo de vida está la póliza. Pulzar los actualiza solos según las fechas:
      </p>
      <ul>
        <li><strong>PROGRAMADA</strong> — la fecha de inicio todavía no llegó. Espera para arrancar.</li>
        <li><strong>VIGENTE</strong> — activa hoy. La fecha de inicio ya pasó y la de fin todavía no.</li>
        <li><strong>NO_VIGENTE</strong> — venció sin renovación.</li>
        <li><strong>RENOVADA</strong> — póliza nueva creada como renovación de otra. Espera latente hasta que arranque su vigencia.</li>
        <li><strong>CANCELADA</strong> / <strong>ANULADA</strong> — dada de baja (ver más abajo).</li>
      </ul>

      <h2>Cancelar vs Anular: cuál usar</h2>
      <p>
        Las dos terminan en una baja pero por motivos distintos. Elegir bien sirve para reportes y respaldos.
      </p>
      <h3>CANCELAR</h3>
      <p>Baja a pedido del cliente. Motivos típicos:</p>
      <ul>
        <li>Decisión del cliente (vendió el bien, ya no le interesa).</li>
        <li>Cambio de compañía.</li>
        <li>Cliente que no renovó cuando le ofreciste.</li>
      </ul>
      <h3>ANULAR</h3>
      <p>Baja a pedido de la compañía. Motivos típicos:</p>
      <ul>
        <li>Falta de pago.</li>
        <li>Fraude detectado.</li>
        <li>Incumplimiento de declaraciones.</li>
        <li>Decisión interna de la compañía.</li>
      </ul>
      <div className="ayuda-warning">
        Cancelar o anular elimina <strong>las renovaciones hijas que estaban en RENOVADA</strong> (todavía no activadas). Las pólizas que ya estaban vigentes se mantienen.
      </div>

      <h2>Rehabilitar una póliza</h2>
      <p>
        Si te equivocaste o el cliente vuelve, podés rehabilitar una póliza CANCELADA o ANULADA. El sistema calcula automáticamente el estado nuevo según la fecha de hoy:
      </p>
      <ul>
        <li>Si la fecha de inicio aún no llegó → vuelve a PROGRAMADA.</li>
        <li>Si está dentro de la vigencia → vuelve a VIGENTE.</li>
        <li>Si la vigencia ya terminó → queda como NO_VIGENTE (histórica).</li>
      </ul>
      <p>
        <strong>Importante</strong>: las renovaciones hijas que se eliminaron al cancelar NO se restauran automáticamente. Si las tenías cargadas, las tenés que crear de nuevo.
      </p>

      <h2>Endosos</h2>
      <p>
        Cualquier modificación durante la vigencia (cambio de patente, agregar conductor, cambiar domicilio del riesgo, sumar cobertura) se registra como <strong>endoso</strong>. Cada endoso tiene su propio número, fecha, motivo, observaciones y archivos PDF de respaldo.
      </p>
      <div className="ayuda-tip">
        Subí el PDF del endoso de la compañía como respaldo. Si después hay un siniestro y te discuten condiciones, tenés el documento exacto disponible.
      </div>

      <h2>Cadena de renovaciones</h2>
      <p>
        Cuando renovás una póliza se crea una <strong>nueva</strong> con número distinto que apunta a la anterior. Esto arma una "cadena" que podés ver en la ficha. Funciona así:
      </p>
      <ul>
        <li>Las <strong>fotos de inspección</strong> viven en la primera póliza de la cadena (la raíz). Las podés ver y subir desde cualquier renovación, pero físicamente están en la raíz.</li>
        <li>La <strong>documentación</strong> rota: cada renovación tiene su carpeta propia. Cuando se activa la renovación, la documentación vieja se borra y queda solo la nueva.</li>
      </ul>
    </>
  )
}
