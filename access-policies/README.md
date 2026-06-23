# AccessPolicy — Paso 4 (control de acceso)

`patient-access-policy.json` resuelve el error **`Forbidden` (403)** al subir un PDF y, a la vez,
garantiza que **cada paciente vea y suba únicamente lo suyo**.

## Por qué hace falta

El paciente no tenía permiso para crear `Binary` + `DocumentReference`. Esta AccessPolicy
se lo otorga, acotado a su propio compartimento FHIR (`%patient`):

| Recurso | Permiso | Para qué |
|---|---|---|
| `Patient` | leer (solo el suyo) | que la app muestre su nombre/perfil |
| `DocumentReference` | leer + **crear** (lo suyo) | **subir el PDF** |
| `Consent` | leer + **crear** (lo suyo) | **registrar su autorización** al enviar |
| `Binary` | leer + crear | guardar el contenido del PDF |
| `DiagnosticReport` | leer (lo suyo) | ver el informe que arma el Bot |
| `Observation` | leer (lo suyo) | ver cada analito que arma el Bot |

> `%patient` lo enlaza Medplum automáticamente al perfil del paciente cuando la
> `ProjectMembership` apunta a un `Patient`. El paciente **no** puede modificar los
> `DiagnosticReport`/`Observation` (son `readonly`): esos los crea el Bot.

## Cómo aplicarla

### Opción A — desde la app de Medplum (visual)

1. Entrá como admin a tu servidor (ej. `https://bio.medplum.com.ar`).
2. **Crear el recurso**: barra de búsqueda → `AccessPolicy` → *New* → pestaña *JSON* →
   pegá el contenido de `patient-access-policy.json` → *Save*.
3. **Asignarla al paciente**: *Project Admin → Users* → elegí al paciente
   (ej. *Mis Caminatas*) → campo **Access Policy** → seleccioná *"Paciente — Agente Archivos"* → *Save*.
4. El paciente cierra sesión y vuelve a entrar. Reintentá la subida: el 403 desaparece.

### Opción B — con el CLI

```bash
# crear la AccessPolicy
npx medplum post AccessPolicy "$(cat access-policies/patient-access-policy.json)"
```

Después asignala a la membership del paciente desde la app (paso 3 de la Opción A).

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
