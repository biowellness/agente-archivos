// Destraba el 403 de los pacientes: les da permiso para subir PDFs (crear Binary +
// DocumentReference + Consent) acotado a lo suyo.
//
// Qué hace (con un ClientApplication ADMIN del Project):
//   1. Crea o actualiza la AccessPolicy "Paciente — Agente Archivos".
//   2. La deja como defaultPatientAccessPolicy del Project  → pacientes NUEVOS.
//   3. La asigna a todas las ProjectMembership de tipo Patient → pacientes ACTUALES.
//
// Uso (desde la raíz del repo, tras `npm install`):
//   MEDPLUM_BASE_URL=https://api.medplum.com.ar/ \
//   MEDPLUM_CLIENT_ID=xxxx MEDPLUM_CLIENT_SECRET=yyyy \
//   node scripts/setup-patient-access.mjs
//
// IMPORTANTE: modifica tu Project y las memberships. Las credenciales deben ser de
// un ClientApplication con acceso de administrador del Project.

import { MedplumClient, createReference } from '@medplum/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.MEDPLUM_BASE_URL;
const clientId = process.env.MEDPLUM_CLIENT_ID;
const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

if (!baseUrl || !clientId || !clientSecret) {
  console.error('Faltan variables: MEDPLUM_BASE_URL, MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const policyDef = JSON.parse(
  readFileSync(join(here, '..', 'access-policies', 'patient-access-policy.json'), 'utf8')
);

const medplum = new MedplumClient({ baseUrl });
await medplum.startClientLogin(clientId, clientSecret);
console.log('✓ Login OK');

// El cliente debe ser admin del Project para crear/asignar AccessPolicy.
if (!medplum.isProjectAdmin() && !medplum.isSuperAdmin()) {
  console.error(
    '\n✗ El ClientApplication NO es admin del Project (entra, pero no puede tocar AccessPolicy/memberships).\n' +
      '  Solucioná una de estas y reintentá:\n' +
      '   1) Hacé admin a ese client: Project Admin → Client Applications → (tu client) → Admin = on.\n' +
      '   2) O usá la guía manual desde la app: access-policies/README.md (Opción A).\n'
  );
  process.exit(1);
}

// 1. Crear o actualizar la AccessPolicy (por nombre).
let policy = await medplum.searchOne('AccessPolicy', 'name=' + encodeURIComponent(policyDef.name));
policy = policy
  ? await medplum.updateResource({ ...policyDef, id: policy.id })
  : await medplum.createResource(policyDef);
const policyRef = createReference(policy);
console.log(`✓ AccessPolicy lista: ${policyRef.reference}`);

// 2. Default para pacientes NUEVOS.
const projectId = medplum.getProject()?.id;
if (projectId) {
  const project = await medplum.readResource('Project', projectId);
  await medplum.updateResource({ ...project, defaultPatientAccessPolicy: policyRef });
  console.log('✓ defaultPatientAccessPolicy seteada en el Project');
} else {
  console.warn('! No pude leer el Project actual; salteo el default (pacientes nuevos).');
}

// 3. Pacientes ACTUALES: asignar la policy a cada membership Patient.
const memberships = await medplum.searchResources('ProjectMembership', '_count=1000');
let fixed = 0;
for (const m of memberships) {
  if (!m.profile?.reference?.startsWith('Patient/')) {
    continue;
  }
  if (m.accessPolicy?.reference === policyRef.reference) {
    continue;
  }
  await medplum.updateResource({ ...m, accessPolicy: policyRef });
  console.log(`  → asignada a ${m.profile.reference} (membership ${m.id})`);
  fixed++;
}
console.log(`✓ Pacientes existentes actualizados: ${fixed}`);
console.log('\nListo. Pedile a cada paciente que cierre sesión y vuelva a entrar para reintentar la subida.');
