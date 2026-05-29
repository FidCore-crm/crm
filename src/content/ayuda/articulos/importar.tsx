export default function Importar() {
  return (
    <>
      <h2>Para qué sirve</h2>
      <p>
        El módulo <strong>Importar cartera</strong> te deja cargar Excel o CSV de las compañías y que el sistema, ayudado por IA, te arme las personas y las pólizas automáticamente. Sirve tanto para cargar tu cartera por primera vez como para actualizarla periódicamente.
      </p>

      <h2>Inicial vs Incremental</h2>
      <h3>INICIAL</h3>
      <p>
        Primera vez que cargás la cartera de una compañía. El sistema asume que <strong>nada existe todavía</strong> y crea todo nuevo. Si después subís el mismo archivo se duplica todo.
      </p>
      <h3>INCREMENTAL</h3>
      <p>
        Actualización periódica (mensual o cuando la compañía te manda el resumen). El sistema compara cada fila con lo que ya tenés y detecta:
      </p>
      <ul>
        <li>Personas y pólizas nuevas (las crea).</li>
        <li>Cambios de datos en clientes ya existentes (los actualiza).</li>
        <li>Renovaciones (cuando solo cambia la fecha de fin).</li>
        <li>Sin cambios (los ignora, no toca nada).</li>
      </ul>
      <div className="ayuda-tip">
        El incremental no duplica nada porque compara por DNI y por número de póliza. Podés correrlo todos los meses sin miedo.
      </div>

      <h2>Pasos del flujo</h2>
      <ol>
        <li><strong>Subir archivos</strong> — hasta 10 archivos, 50 MB cada uno.</li>
        <li><strong>Análisis con IA</strong> — Claude lee una muestra y propone el mapeo (qué columna es qué campo del CRM).</li>
        <li><strong>Revisar el plan</strong> — confirmás o ajustás el mapeo.</li>
        <li><strong>Procesar lotes</strong> — el sistema valida, deduplicar, detecta dudosos.</li>
        <li><strong>Revisar dudosos</strong> — items con DNI raros, duplicados, compañías no reconocidas, etc. Decidís uno por uno.</li>
        <li><strong>Confirmar e importar</strong> — los INSERTs efectivos en la base.</li>
        <li><strong>Completada</strong> — resumen con totales y catálogos creados.</li>
      </ol>

      <h2>Deshacer dentro de 24 horas</h2>
      <p>
        Si después de importar te das cuenta que algo salió mal, podés <strong>deshacer</strong> la importación dentro de las 24 horas. El sistema elimina las personas, pólizas y riesgos que se crearon. Las entidades que tuvieron actividad después (siniestros, tareas) se preservan.
      </p>
      <div className="ayuda-warning">
        Los <strong>updates</strong> de incremental NO se revierten (no hay snapshot del estado previo). Solo se revierten creaciones.
      </div>

      <h2>Requisito previo: la API key de Anthropic</h2>
      <p>
        El análisis con IA necesita una key de Anthropic configurada en{' '}
        <strong>Configuración → Agente IA</strong>. Si no la tenés, el módulo te muestra un onboarding con instrucciones.
      </p>
    </>
  )
}
