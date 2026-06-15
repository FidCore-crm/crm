export default function Comunicaciones() {
  return (
    <>
      <h2>Dos sistemas de email en uno</h2>
      <p>
        FidCore tiene dos conjuntos de emails que es importante no confundir:
      </p>
      <ul>
        <li>
          <strong>Emails automáticos del sistema</strong> — los configurás en{' '}
          <strong>Configuración → Comunicaciones</strong>. Son disparados por eventos: una póliza pasa a vigente, hay un backup que falló, se procesó un PDF. Funcionan solos en background.
        </li>
        <li>
          <strong>Comunicaciones activas</strong> — viven en{' '}
          <strong>Comunicaciones</strong> (sidebar). Son lo que el PAS manda explícitamente: campañas masivas, mailings a segmentos, promociones puntuales.
        </li>
      </ul>

      <h2>Todos los emails arrancan apagados</h2>
      <p>
        Por defecto, todos los envíos automáticos vienen <strong>desactivados</strong> en una instalación nueva. Esto evita que se manden emails sin querer mientras estás configurando. Andá a Configuración → Comunicaciones y activá los que necesites uno por uno.
      </p>

      <h2>Plantillas vs Audiencias vs Campañas</h2>
      <h3>Plantillas</h3>
      <p>
        Una <strong>plantilla</strong> es un template reutilizable con texto del email (asunto, saludo, cuerpo, cierre, CTA). Las creás una vez y las reusás en muchas campañas.
      </p>
      <h3>Audiencias</h3>
      <p>
        Una <strong>audiencia</strong> es un grupo de destinatarios. Hay dos tipos:
      </p>
      <ul>
        <li><strong>FILTRO</strong> — definís criterios (clientes con pólizas que vencen en X días, de una compañía específica, con email válido, etc.). El sistema arma la lista al momento del envío. Se actualiza sola.</li>
        <li><strong>MANUAL</strong> — elegís personas una por una. La lista queda fija.</li>
      </ul>
      <h3>Campañas</h3>
      <p>
        Una <strong>campaña</strong> es una audiencia + una plantilla + un horario de envío. Las campañas tienen estados: <code>BORRADOR</code> → <code>PROGRAMADA</code> → <code>EJECUTANDO</code> → <code>COMPLETADA</code>. Las podés pausar a mitad de envío.
      </p>

      <h2>Wizard rápido para envíos puntuales</h2>
      <p>
        Si no querés crear plantilla + audiencia + campaña por separado, el botón{' '}
        <strong>"Nuevo envío"</strong> en /crm/comunicaciones te lleva por un wizard de 4 pasos que arma todo en una sola pasada para un envío único.
      </p>

      <h2>Anti-spam y bajas</h2>
      <p>
        El sistema respeta dos cosas automáticamente:
      </p>
      <ul>
        <li><strong>Lista de bajas</strong> — si una persona se desuscribió (click en el link del email), no se le manda más. Los emails transaccionales (bienvenida, portal, renovación, password reset) <strong>se mandan igual</strong> porque son obligatorios.</li>
        <li><strong>Anti-duplicados</strong> — si una persona ya recibió el mismo tipo de email recientemente, no se le manda otro. Evita confusión si el cron corre varias veces sobre la misma transición.</li>
      </ul>
    </>
  )
}
