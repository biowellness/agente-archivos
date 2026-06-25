# AccessPolicy — Paso 4 (control de acceso)

`patient-access-policy.json` es la policy real del portal (**`Paciente — Portal`**): resuelve el
error **`Forbidden` (403)** al subir un PDF y, a la vez, acota a cada paciente a **lo suyo** (`%patient`).

> ⚠️ **Corrección aplicada:** el criterio de `Consent` decía `Consent?subject=%patient`, pero en
> FHIR R4 `Consent` no tiene `subject` sino `patient`. Quedó como `Consent?patient=%patient`
> (coincide con cómo el front crea el Consent). Sin esto, el paso del Consent daría 403.

## Qué habilita (lo relevante para la subida)

| Recurso | Permiso | Para qué |
|---|---|---|
| `Binary` | crear/leer (interacciones explícitas) | guardar el contenido del PDF |
| `DocumentReference` | crear + leer (lo suyo) | **subir el PDF** |
| `Consent` | crear + leer (lo suyo) | **registrar la autorización** |
| `Patient` | leer/editar (su perfil) | mostrar/actualizar sus datos |
| `Observation` | crear + leer (lo suyo) | sus biomarcadores (los del laboratorio los crea el Bot) |
| `DiagnosticReport` | **readonly** | ver el informe que arma el Bot |

Además da **lectura** del resto del portal (turnos, cobertura, plan, medicación, tareas) y de los
catálogos (cuestionarios, agenda, profesionales, organización).

> `%patient` lo enlaza Medplum automáticamente cuando la `ProjectMembership` apunta a un `Patient`.
> Los `DiagnosticReport` son `readonly`: los arma el Bot, el paciente no los edita.

## Capacidades del portal completo

| Capacidad | Cómo se hace | Permiso |
|---|---|---|
| Registrarse / completar perfil | alta + edición de datos | alta = registro del Project (esta policy como **default de pacientes**); `Patient` escribible (lo suyo) |
| Hacer reservas | ejecuta el Bot `bw-solicitar-turno` | Bot ejecutable + lectura de `Appointment`/`Slot`/`Schedule`/`HealthcareService` (Appointment **readonly**: lo crea el Bot) |
| Completar observaciones | biomarcadores / formularios | `Observation` + `QuestionnaireResponse` escribibles (lo suyo) |
| Enviar documentos | subir PDF + autorizar | `Binary` create + `DocumentReference` + `Consent` escribibles |
| Ver su historia | resultados / plan / cobertura | `DiagnosticReport`, `CarePlan`, `MedicationRequest`, `Immunization`, `Task`, `Coverage`, `Invoice` → readonly |

**Reservas por Bot, no por escritura directa:** `Appointment` queda `readonly` a propósito. El paciente
*pide* el turno ejecutando `bw-solicitar-turno`; el Bot valida el slot y crea el `Appointment`. Así no
puede fabricar turnos arbitrarios — mismo patrón que el upload (el paciente dispara, el backend crea).

> Endurecimiento opcional: para separar lo autoreportado de lo validado por laboratorio, acotar la
> escritura del paciente con categoría, ej. `Observation?subject=%patient&category=survey`.

## Cómo aplicarla

### Opción A — desde la app de Medplum (visual)

1. Entrá como admin a tu servidor (ej. `https://bio.medplum.com.ar`).
2. **Crear el recurso**: barra de búsqueda → `AccessPolicy` → *New* → pestaña *JSON* →
   pegá el contenido de `patient-access-policy.json` → *Save*.
3. **Asignarla al paciente**: *Project Admin → Users* → elegí al paciente
   (ej. *Mis Caminatas*) → campo **Access Policy** → seleccioná *"Paciente — Portal"* → *Save*.
4. El paciente cierra sesión y vuelve a entrar. Reintentá la subida: el 403 desaparece.

### Opción B — con el CLI

```bash
# crear la AccessPolicy
npx medplum post AccessPolicy "$(cat access-policies/patient-access-policy.json)"
```

Después asignala a la membership del paciente desde la app (paso 3 de la Opción A).

### Opción C — script (recomendado: arregla TODOS los pacientes de una)

`scripts/setup-patient-access.mjs` crea/actualiza la policy, la deja como
**default de pacientes** (para los nuevos) y la **asigna a todos los pacientes
actuales**. Necesita un `ClientApplication` **admin** del Project.

```bash
npm install   # una vez
MEDPLUM_BASE_URL=https://api.medplum.com.ar/ \
MEDPLUM_CLIENT_ID=xxxx MEDPLUM_CLIENT_SECRET=yyyy \
node scripts/setup-patient-access.mjs
```

Al terminar, cada paciente debe **cerrar sesión y volver a entrar**.

## Para los próximos pacientes

Para que **todo** paciente invitado la reciba sin tocarla a mano:

- Al invitar: pasá esta AccessPolicy en `inviteUser` (campo `accessPolicy`), **o**
- Configurala como *Default Patient Access Policy* del Project (Project settings).

## Importante: el Bot NO usa esta policy

`parse-lab-report` corre con su propia membership y necesita **leer** `Binary`/`DocumentReference`
y **crear** `Observation`/`DiagnosticReport` de *cualquier* paciente del Project. Dejalo con su
acceso de servicio (admin del Project o una AccessPolicy aparte más amplia) — no le pongas la
policy de paciente.

## Consent

Al enviar un estudio, el portal crea un recurso `Consent` (`status: active`,
`scope: patient-privacy`) vinculado al `DocumentReference` (`sourceReference` y
`provision.data`). La casilla de autorización en el formulario es obligatoria, así
que **no hay subida sin consentimiento registrado**.
