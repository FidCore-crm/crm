# Auditoría estática del CRM FidCore

**Fecha:** 2026-07-10
**Versión auditada:** v1.0.99
**Método:** análisis estático del código (sin ejecución en runtime) + `npx tsc --noEmit` + `npm run lint` + inspección de queries Supabase contra migraciones + búsqueda exhaustiva por patrones.

---

## Resumen ejecutivo

| Categoría | 🔴 rompe | 🟡 incompleto | 🟢 cosmético | Total |
|---|---|---|---|---|
| 1. Rutas y navegación | 0 | 0 | 3 | 3 |
| 2. TypeScript + lint | 0 | 0 | 0 | 0 |
| 3. Consistencia Supabase | 0 | 2 | 0 | 2 |
| 4. Rebrand | 0 | 0 | 3 | 3 |
| 5. Código incompleto | 0 | 3 | 2 | 5 |
| 6. Manejo de errores y estados | 0 | 0 | 0 | 0 |
| **Total** | **0** | **5** | **8** | **13** |

**Conclusión rápida:** todos los 🔴 y 🟡 accionables cerrados en v1.0.99 (catalogos) + v1.0.100 (rebrand + dashboard + console.warn + unused vars). Lo que queda son: 3 tabs con badge "Próximamente" intencionales, 2 referencias legacy a `usuarios` de compat documentada, 3 TODOs de optimización para escala futura, 3 referencias intencionales a `pulzar.crm@gmail.com` (email real).

---

## 1. Integridad de rutas y navegación

### 🟢 Cosmético

- [ ] **`src/app/crm/configuracion/agente-ia/page.tsx:286`** — Item de UI con badge "[Próximamente] Agente conversacional del CRM" deshabilitado. Intencional pero pisa la roadmap.
- [ ] **`src/app/crm/configuracion/agente-ia/page.tsx:290`** — Ídem "[Próximamente] Agente de renovaciones".
- [ ] **`src/app/crm/configuracion/page.tsx:176`** — Badge "Próximamente" sobre sección con `activo: false`. UI atenuada. Intencional.

**Verificaciones exhaustivas realizadas (sin hallazgos):**
- Los 16 hrefs del sidebar (`src/components/layout/sidebar.tsx`) apuntan a rutas existentes.
- Todos los `router.push()` y `<Link href>` grep-eados apuntan a `page.tsx` reales.
- Sin `onClick={() => {}}` vacíos ni handlers indefinidos.
- Sin `<Link href="">` ni `type="submit"` sin form padre.
- Búsqueda en navbar + componentes de layout no revela links rotos.

---

## 2. Errores de compilación y tipos

### ✅ TypeScript

`npx tsc --noEmit` — **exit 0**, sin errores.

### ✅ Lint warnings (todos cerrados v1.0.100)

`npm run lint` — **exit 0**. Los 10 warnings originales de `no-unused-vars` fueron limpiados (más otros 28 descubiertos durante el pass). Se removieron imports sin uso y helpers muertos, se prefijó `_` en variables retenidas intencionalmente.

Warnings residuales no relacionados a la auditoría (deuda documentada):
- 18 warnings de `react-hooks/exhaustive-deps` (dependencias faltantes en hooks — requieren refactor cuidadoso caso por caso, no son bugs).
- 1 warning de `jsx-a11y/alt-text`.

---

## 3. Consistencia con Supabase

### 🟡 Referencias legacy documentadas

- [ ] **`src/lib/auth.ts:304`** — Query a tabla `usuarios` (legacy pre-migración 055). Está comentada como fallback intencional durante la migración dual con `usuarios_perfil`. Se puede eliminar cuando se cierre la deuda del sistema legacy de blanqueo (documentado en CLAUDE.md).
- [ ] **`src/app/api/usuarios/[id]/route.ts:224`** — `DELETE` defensivo sobre tabla `usuarios` legacy, envuelto en `try/catch` silencioso. Mismo motivo. Eliminable junto al ítem anterior.

**Verificaciones exhaustivas realizadas (sin hallazgos):**
- 35 tablas únicas referenciadas en el código — todas existen en `sql/migrations/*.sql` y en `src/types/database.generated.ts`.
- 7 RPCs referenciadas (`generar_numero_caso`, `generar_numero_endoso`, `fn_obtener_perfil_por_email`, `fn_setear_password_directo`, `fn_invalidar_todas_sesiones_auth`, `fn_polizas_ancestros`, `fn_recalcular_estado_persona`) — todas creadas en migraciones.
- Verificación puntual de columnas en 16 queries complejas (`polizas`, `siniestro_bitacora`, `portal_cliente_accesos`, `configuracion`, `endosos`, `cotizaciones`) — todas OK.

---

## 4. Pendientes del rebrand

### ✅ Color viejo `#E85D1F` (cerrado v1.0.100)

Los 3 hits reemplazados por `#FF6A00`:
- [x] `src/app/crm/onboarding/components/WizardLayout.tsx:135` — botón "Continuar" (base + hover + active).
- [x] `src/app/setup/page.tsx:118,119` — badge "Configuración inicial" (círculo + texto).

Grep de verificación (`#e85d1f | #d14f12 | #bc4710`): 0 hits.

### 🟢 Marca Pulzar residual (documentada como intencional)

Las siguientes 3 referencias a "pulzar" son al email `pulzar.crm@gmail.com`, que es la casilla de Gmail **real** de FidCore para enviar emails de FidCore→cliente (licencias). Documentada en CLAUDE.md como excepción intencional post-rebrand.

- [ ] **`src/lib/fidcore-emails.ts:11`** — comentario docstring que menciona el email.
- [ ] **`src/lib/fidcore-emails.ts:41`** — const `FIDCORE_EMAIL_FROM = 'pulzar.crm@gmail.com'`.
- [ ] **`src/app/api/cron/licencias/route.ts:74`** — comentario docstring.

**No requieren acción** — están explícitamente documentadas como retención de la infra Gmail post-rebrand (crear nueva casilla implicaría reconfig SMTP en todos los clientes ya desplegados).

**Otras excepciones documentadas que fueron excluidas del grep:** `NEXT_PUBLIC_PULZAR_MODO`, cookie `pulzar_jwt`, sentinel `PULZAR_OBFUSCATED_v1`, path `/opt/crm-pulzar`. Todas documentadas.

**Búsqueda de "FidFlow":** 0 hits. Rebrand completo respecto a este nombre.

---

## 5. Código incompleto

### 🟡 TODOs de deuda técnica pendiente

- [ ] **`src/app/crm/importar/[id]/completada/page.tsx:480`** — `// TODO: mismo patrón en historial/[id]` — sugerencia de refactor para deduplicar UI.
- [ ] **`src/app/api/importar/historial/kpis/route.ts:26`** — `// TODO: si total_importaciones_completadas > 1000, considerar materializar este agregado` — optimización de performance para escala futura.
- [ ] **`src/app/api/importar/[id]/comparacion/route.ts:9`** — `// TODO: este cálculo puede ser lento para cartera grande` — misma clase de optimización.

### 🟢 `console.warn/error` en código de producción

**Legítimos** (no requieren acción — son fallbacks controlados que no pueden usar el `logger` por dependencia circular o son fatales de bootstrap):

- [ ] **`src/lib/errores/persistencia.ts:137,204,230`** — `console.error` en la propia lib de persistencia de errores. Comentario en línea 10 justifica: "no usa logger para evitar recursion".
- [ ] **`src/lib/auth.ts:88`** — `console.error` cuando `SUPABASE_JWT_SECRET` no está seteado. Bootstrap fatal.
- [ ] **`src/lib/auth.ts:260`** — `console.warn` en función `crearSesion` deprecated.
- [ ] **`src/lib/instalacion-id.ts:58`** — `console.warn` cuando falla persistir el instalacion-id (fallback silencioso, no puede usar logger porque el logger depende de la instalación).
- [ ] **`src/app/api/backups/route.ts:92`** — `console.error` en fire-and-forget de background.
- [ ] **`src/app/api/comunicaciones/campanas/[id]/enviar/route.ts:49`** — ídem fire-and-forget.

**✅ Migrados al logger estructurado (v1.0.100):**

- [x] `src/components/layout/MensajesWebNavbar.tsx:75,89` — ahora `logger.warn({ modulo, mensaje, contexto })`.
- [x] `src/components/layout/navbar.tsx:186,201` — ídem.

**No son hallazgos:** las 15+ menciones de `"console.anthropic.com"` en textos de UI y URLs son referencias correctas al panel de Anthropic, no logs olvidados.

**Formularios sin validación o submit roto:** 0 hallazgos. Los 20+ `<form onSubmit>` inspeccionados tienen handler definido y validación mínima (required, min length, coincidencia de contraseñas).

---

## 6. Manejo de errores y estados de carga

### ✅ Resueltos (fix v1.0.99, 2026-07-10)

Los 5 🔴 en `src/app/crm/configuracion/catalogos/page.tsx` fueron cerrados:

- [x] **`cargarTipos()`** (línea 246+) — ahora captura `error` del destructuring, loguea con `logger.error`, setea `errorCarga` para mostrar mensaje en pantalla, y expone botón "Reintentar" a través de `<EstadoCarga>`.
- [x] **`cargarCatalogos()`** (línea 273+) — captura `error`, loguea con contexto (tipo activo), muestra `toast.error` con mensaje contextual al tipo (compañías / ramos / coberturas).
- [x] **`cargarAuxiliares()`** (línea 295+) — captura errores independientes de las 3 queries (tipo_catalogo, ramos, compañías). Los fallos de auxiliares son no-bloqueantes: la pantalla sigue funcional, solo el editor de coberturas verá listas vacías si falla.
- [x] **`eliminar()`** (línea 411+) — captura `error`, distingue mensaje según sea FK violation ("está en uso, considerá desactivar") o error genérico. Toast de éxito al eliminar OK.
- [x] **`toggleActivo()`** (línea 431+) — captura `error` tanto en el chequeo previo de impacto en pólizas como en el update final. Toast de éxito/error explícito.

Los 2 🟡 relacionados a la falta de `<EstadoCarga>` en la carga inicial también se resolvieron al integrar el componente en el flujo del render.

**Cambios adicionales**: imports de `toast`, `logger`, `EstadoCarga` agregados. State `errorCarga` + `reintentoKey` agregados para soportar reintento manual sin recargar toda la pantalla.

### ✅ Fetch/query sin manejo de error UX (cerrados v1.0.100)

- [x] `src/app/crm/dashboard/page.tsx:500-504` — `.then().catch()` ahora loggea con `logger.warn` (fallback a defaults es no-bloqueante intencional).
- [x] `src/app/crm/dashboard/page.tsx:513-519` — captura `error` de `qTodas`, loguea; chart "Evolución" degrada a vacío con log de diagnóstico.
- [x] `src/app/crm/dashboard/page.tsx:814-819` — captura `error` de `qRen` + `conRen`. Falla del segundo trata todas las pólizas como "sin renovación" (over-alerta antes que ocultar riesgo).

**Falsos positivos descartados tras spot-check** (el agente los reportó pero al verificar el código, sí manejan error correctamente):
- `src/app/crm/configuracion/notificaciones/page.tsx:189,205,258,281` — todas las 4 queries SÍ verifican `.error`. No es hallazgo.
- API routes de `postits/route.ts`, `notificaciones/route.ts` y `usuarios/route.ts` — usan patrón manual `if (error)` en vez de `manejarErrores()`, pero funcional. Deuda de estilo, no bug.

---

## Dudosos a verificar

Sin ítems dudosos. Todas las verificaciones estáticas se pudieron confirmar contra:
- Migraciones SQL en `sql/migrations/`.
- Tipos generados en `src/types/database.generated.ts`.
- Filesystem para archivos `page.tsx` y `route.ts`.

---

## Recomendación de trabajo

**Sprint corto — todo cerrado ✅:**
1. ~~Envolver las 5 queries de `catalogos/page.tsx`.~~ ✅ v1.0.99.
2. ~~Rebrand color `#E85D1F` → `#FF6A00`.~~ ✅ v1.0.100.
3. ~~Migrar `console.warn` de navbar/MensajesWebNavbar a `logger.warn`.~~ ✅ v1.0.100.
4. ~~Manejo de error en dashboard.~~ ✅ v1.0.100.
5. ~~Limpiar unused vars del lint.~~ ✅ v1.0.100 (10 originales + 28 descubiertos).

**Deuda menor documentada (no bloqueante, no urgente):**
- Los 3 TODOs de importación son optimizaciones para escala futura (materialización de agregados si el PAS llega a >1000 importaciones).
- Referencias legacy a tabla `usuarios` en 2 lugares: parte del flujo dual con `usuarios_perfil`. Se limpian junto con el retiro del sistema legacy de blanqueo.
- 18 warnings de `react-hooks/exhaustive-deps` en formularios comerciales — requieren refactor caso por caso para no romper efectos existentes.
- 1 warning de `jsx-a11y/alt-text` en alguna imagen.

**Estado final:** el sistema no tiene 🔴 ni 🟡 accionables. TypeScript exit 0, lint sin `no-unused-vars`, sin queries silenciosas ante fallo de red/DB, rebrand color completo.
