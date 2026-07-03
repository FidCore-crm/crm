export default function Renovaciones() {
  return (
    <>
      <h2>Cuándo aparece una póliza en Renovaciones</h2>
      <p>
        El módulo <strong>Renovaciones</strong> muestra todas las pólizas VIGENTES que vencen en los próximos 30 días, ordenadas por urgencia. También las que ya vencieron sin renovarse.
      </p>
      <ul>
        <li><strong>Rojo</strong> — vence en 7 días o menos.</li>
        <li><strong>Naranja</strong> — vence entre 7 y 15 días.</li>
        <li><strong>Ámbar</strong> — vence entre 15 y 30 días.</li>
        <li><strong>Gris</strong> — vencida sin renovación cargada.</li>
        <li><strong>Violeta</strong> — ya tiene una renovación cargada esperando activarse.</li>
      </ul>

      <h2>Cómo es el proceso de renovación</h2>
      <ol>
        <li>Hacés clic en "Renovar" en una póliza que vence.</li>
        <li>Se abre un formulario precargado con los datos de la actual: ramo, compañía, cobertura, bien asegurado, asegurado.</li>
        <li>Ajustás lo que cambió (sumas aseguradas, refacturación, datos del bien asegurado si renovás un cambio).</li>
        <li>Subís el PDF de la renovación nueva en la carpeta de "documentación renovada".</li>
        <li>Se crea una <strong>póliza nueva</strong> en estado RENOVADA, latente, esperando que llegue su fecha de inicio.</li>
      </ol>

      <h2>Qué pasa cuando la renovación se activa</h2>
      <p>
        Un cron del sistema corre cada 4 horas. Cuando detecta que llegó la fecha de inicio de una póliza RENOVADA:
      </p>
      <ul>
        <li>La renovación pasa a <strong>VIGENTE</strong>.</li>
        <li>La póliza vieja pasa a <strong>NO_VIGENTE</strong>.</li>
        <li>Los archivos de la carpeta "documentación renovada" se mueven a "documentación" en la nueva.</li>
        <li>La "documentación" de la póliza vieja se borra (ya no es relevante).</li>
        <li>Las fotos de inspección quedan donde estaban (en la raíz de la cadena).</li>
      </ul>

      <div className="ayuda-tip">
        Podés ver toda la cadena de renovaciones desde la ficha de cualquier póliza, en la sección "Cadena de renovaciones". Te muestra desde la raíz hasta la versión más nueva.
      </div>

      <h2>Si el cliente decide no renovar</h2>
      <p>
        Si ya cargaste la renovación pero el cliente se arrepiente, podés cancelar la póliza vieja. El sistema elimina la renovación latente (junto con sus riesgos, archivos y registros) y deja la cadena cerrada.
      </p>
    </>
  )
}
