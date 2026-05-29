export default function Personas() {
  return (
    <>
      <h2>Qué es una persona en Pulzar</h2>
      <p>
        "Persona" es cualquier cliente, prospecto o tomador con el que trabajás. Pueden ser{' '}
        <strong>físicas</strong> (con DNI) o <strong>jurídicas</strong> (empresas con CUIT).
        Cada persona puede tener una o muchas pólizas, siniestros, tareas y oportunidades.
      </p>

      <h2>Los 4 estados de un cliente</h2>
      <ul>
        <li><strong>PROSPECTO</strong> — todavía no compró nada. Lo cargás cuando aparece como lead.</li>
        <li><strong>ACTIVO</strong> — tiene al menos una póliza vigente con vos.</li>
        <li><strong>INACTIVO</strong> — ya no opera. Lo dejás acá en vez de borrarlo por si vuelve.</li>
        <li><strong>BLOQUEADO</strong> — fraude, mora pesada, decisión interna. No le podés vender más.</li>
      </ul>
      <p>
        Los estados cambian solos cuando corresponde: si a un PROSPECTO le cargás una póliza vigente, pasa a ACTIVO. Si todas sus pólizas se cancelan, queda INACTIVO.
      </p>

      <h2>Buscar y filtrar</h2>
      <p>
        El listado tiene búsqueda por <strong>DNI, nombre, apellido, razón social, teléfono y email</strong>.
        La búsqueda no distingue mayúsculas ni acentos — escribís "lopez" y encuentra "López".
      </p>

      <h2>Eliminar y la papelera</h2>
      <p>
        Eliminar una persona <strong>NO la borra definitivamente</strong>. Pasa a la papelera durante 30 días por si fue un error.
        Mientras tanto sus pólizas, siniestros y tareas también se ocultan. Al pasar los 30 días, un proceso automático borra todo (datos + archivos físicos del disco).
      </p>
      <div className="ayuda-warning">
        Si la persona tiene pólizas <strong>VIGENTES</strong>, el sistema te bloquea la eliminación. Tenés que cancelar/anular las pólizas primero o esperar a que venzan.
      </div>

      <h2>Portal del Asegurado</h2>
      <p>
        Cada persona puede tener un acceso al Portal donde ve sus pólizas, siniestros activos y los teléfonos de asistencia 24h. Se gestiona desde el tab "Portal" en la ficha del cliente: generás un link único y se lo enviás por email o WhatsApp.
      </p>
    </>
  )
}
