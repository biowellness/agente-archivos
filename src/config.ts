// Configuración de los Projects FHIR del servidor Medplum.
// Un único servidor (MEDPLUM_BASE_URL) con un Project por institución.
// Los IDs se cargan desde variables de entorno (.env / .env.defaults).

export interface MedplumProjectOption {
  /** Project ID (UUID) en el servidor Medplum. */
  id: string;
  /** Etiqueta visible para el paciente en el selector de login. */
  label: string;
}

/**
 * Instituciones disponibles para iniciar sesión.
 * Se descartan las que no tengan un Project ID configurado.
 */
export const MEDPLUM_PROJECTS: MedplumProjectOption[] = (
  [
    { id: import.meta.env.MEDPLUM_PROJECT_ID_BIO, label: 'Bio' },
    { id: import.meta.env.MEDPLUM_PROJECT_ID_RECEPCION, label: 'Recepción' },
  ] satisfies { id: string | undefined; label: string }[]
).filter((p): p is MedplumProjectOption => Boolean(p.id));
