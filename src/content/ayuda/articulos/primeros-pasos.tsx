export default function PrimerosPasos() {
  return (
    <>
      <h2>Configuración mínima antes de empezar</h2>
      <p>
        Antes de cargar tu primera póliza te conviene dejar listas algunas cosas en{' '}
        <strong>Configuración</strong>. Te tomará 15-20 minutos y te evita problemas más adelante.
      </p>

      <h3>1. Datos del PAS u Organización</h3>
      <p>
        Andá a <strong>Configuración → Perfil</strong> y completá nombre, matrícula SSN, datos de
        contacto y subí tu logo. Si trabajás como persona, cargás tus datos como PAS; si sos una
        SRL o SA de productores, cargás los datos de la organización. Esa información aparece en
        los emails que mandás a clientes y en el Portal del Asegurado.
      </p>

      <h3>2. Configurar SMTP</h3>
      <p>
        En <strong>Configuración → Correos</strong> cargás los datos de tu servidor de email
        (host, puerto, usuario, contraseña). Sin esto no podés mandar emails de bienvenida ni
        campañas. Si usás Gmail vas a necesitar una "contraseña de aplicación".
      </p>
      <div className="ayuda-tip">
        Apretá <strong>"Probar conexión"</strong> antes de salir. Si funciona, te llega un email
        de prueba a vos mismo.
      </div>

      <h3>3. Compañías, ramos y coberturas</h3>
      <p>
        En <strong>Configuración → Catálogos</strong> cargás las compañías con las que trabajás,
        los ramos (Automotor, Hogar, Vida, etc.) y las coberturas que ofrecen. Solo cargá lo que
        realmente vas a usar — sumá cosas a medida que las necesites.
      </p>

      <h3>4. Activar emails automáticos (opcional)</h3>
      <p>
        Por defecto todos los envíos automáticos vienen apagados para que no se manden emails sin
        querer. En <strong>Configuración → Comunicaciones</strong> los podés activar uno por uno:
        bienvenida de póliza, renovación, acceso al portal, avisos al admin.
      </p>

      <h3>5. Crear usuarios (si trabajás con equipo)</h3>
      <p>
        En <strong>Configuración → Usuarios</strong> invitás a los miembros de tu equipo. Cada uno
        recibe un email para definir su contraseña. Podés decidir si ve toda la cartera o solo la
        propia.
      </p>

      <h2>¿Cómo seguir?</h2>
      <ul>
        <li>Si tenés una cartera vieja para importar: andá a <strong>Importar cartera</strong> y subí los Excel.</li>
        <li>Si arrancás de cero: empezá creando personas y pólizas manualmente.</li>
        <li>Si querés explorar primero: usá los datos de ejemplo que aparecen en el dashboard.</li>
      </ul>
    </>
  )
}
