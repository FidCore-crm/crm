// Re-exporta el renderizador DB-backed.
// Las plantillas hardcodeadas viejas fueron eliminadas — el sistema lee
// desde la tabla `plantillas_email`, seedeada por la migración 013.

export {
  renderizarPlantilla,
  renderizarPlantillaDraft,
  obtenerPlantilla,
  escapeHtml,
  type PlantillaRenderizada,
  type OrganizacionInfo,
  type RenderOptions,
} from './renderizador'
