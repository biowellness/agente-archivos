# Bots de Agente Archivos

Bots de Medplum que corren en el servidor. Hoy hay uno:

## `parse-lab-report`

Cuando se crea un `DocumentReference` con un PDF, este Bot:

1. Descarga el PDF (Binary) del `DocumentReference`.
2. Se lo manda a **Claude** (`claude-opus-4-8`) como documento nativo (sin OCR manual).
3. Recibe los analitos en JSON validado (structured outputs con Zod).
4. Crea una **`Observation`** por analito y un **`DiagnosticReport`** que las agrupa,
   vinculados al paciente (`subject` del `DocumentReference`) y al PDF original.

## Requisitos

- [Medplum CLI](https://www.medplum.com/docs/cli): `npm i -g @medplum/cli` (o `npx @medplum/cli`).
- Variables del CLI para autenticarte contra el servidor:
  `MEDPLUM_BASE_URL`, `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET`.
- **Secret del Project**: `ANTHROPIC_API_KEY` (Medplum app → *Project → Secrets*).
  El Bot lo lee de `event.secrets['ANTHROPIC_API_KEY']`.

## Build

```bash
cd bots
npm install
npm run build      # type-check + bundle a dist/parse-lab-report.js
```

## Deploy

1. Creá el recurso `Bot` (una vez) y anotá su `id`:
   ```bash
   npx medplum bot create parse-lab-report
   ```
2. Pegá ese `id` en `medplum.config.json` (raíz del repo), reemplazando
   `REEMPLAZAR_POR_EL_BOT_ID`.
3. Deployá:
   ```bash
   npx medplum bot deploy parse-lab-report
   ```

## Disparador: Subscription sobre DocumentReference

Creá una `Subscription` que invoque al Bot al crearse un `DocumentReference`
(ajustá `Bot/<id>`):

```json
{
  "resourceType": "Subscription",
  "status": "active",
  "reason": "Parsear PDF de laboratorio al subirse",
  "criteria": "DocumentReference",
  "channel": {
    "type": "rest-hook",
    "endpoint": "Bot/REEMPLAZAR_POR_EL_BOT_ID"
  }
}
```

> Para acotar el disparo solo a estudios de laboratorio, podés usar
> `"criteria": "DocumentReference?category=http://loinc.org|26436-6"`.

## Permisos

El Bot corre con su propia membership. Necesita poder **leer** `Binary`/`DocumentReference`
y **crear** `Observation`/`DiagnosticReport` en el Project. Si usás `AccessPolicy`,
asegurate de otorgarle esos recursos.

## Notas

- Límite de PDF de la API de Claude: 32 MB / request (el portal ya limita la subida a 25 MB).
- El Bot no inventa valores: si el PDF no tiene resultados, no crea Observations.
- `dist/` y `node_modules/` están en `.gitignore`.
