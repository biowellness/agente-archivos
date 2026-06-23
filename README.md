# agente-archivos

Portal de pacientes para enviar PDF de resultados de laboratorio a **Medplum** (FHIR) y dejarlos
disponibles en la historia clínica electrónica interoperable.

> El paciente es el dueño de sus datos: los resultados solo se comparten **con su autorización**.

Basado en [`medplum-hello-world`](https://github.com/medplum/medplum-hello-world)
(Medplum 5.1.x · React 19 · Vite · Mantine 8).

## Arquitectura

```
Paciente → portal.medplum.com.ar (esta app React)
   │  1. Login (email/contraseña o Google), elige institución (Bio / Recepción)
   │  2. Sube un PDF  →  Binary + DocumentReference (FHIR)
   ▼
Servidor Medplum (1 servidor, 2 Projects: Bio y Recepción)
   │  3. Subscription dispara un Bot al crearse el DocumentReference
   ▼
Bot  →  parsea el PDF  →  crea Observation / DiagnosticReport
```

- **Un servidor Medplum**, un Project FHIR por institución (`Bio`, `Recepción`).
- Login con `SignInForm` de `@medplum/react` (email+contraseña y Google).
- Alta de pacientes **por invitación** de la clínica (`inviteUser`), no auto-registro.
- Acceso restringido por `AccessPolicy`: cada paciente ve únicamente lo suyo.

## Roadmap

- [x] **Paso 1 — Autenticación** (login + selector de institución por `projectId`).
- [x] **Paso 2 — DocumentReference** (subir el PDF: `Binary` + `DocumentReference`).
- [x] **Paso 3 — Bot** (Subscription → Claude parsea el PDF → `Observation`/`DiagnosticReport`). Ver [`bots/`](./bots).
- [x] **Paso 4 — AccessPolicy** (cada paciente ve/sube solo lo suyo). Ver [`access-policies/`](./access-policies).
- [x] **Paso 4 — Consent** (casilla obligatoria + recurso `Consent` vinculado al estudio).

## Configuración

Copiá los valores reales en `.env` (se genera solo desde `.env.defaults` en el primer `npm run dev`):

| Variable | Descripción |
| --- | --- |
| `MEDPLUM_BASE_URL` | URL de la API del servidor Medplum (ej. `https://api.medplum.com.ar/`). |
| `MEDPLUM_PROJECT_ID_BIO` | Project ID (UUID) de la institución **Bio**. |
| `MEDPLUM_PROJECT_ID_RECEPCION` | Project ID (UUID) de la institución **Recepción**. |
| `GOOGLE_CLIENT_ID` | (Opcional) Client ID de Google OAuth, habilitado en el servidor. |
| `MEDPLUM_CLIENT_ID` | (Opcional) Client ID de una `ClientApplication` (PKCE). |

> `.env` está en `.gitignore`. **Nunca** commitees secretos.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # type-check + build de producción
```
