import { BotEvent, MedplumClient, createReference, getReferenceString } from '@medplum/core';
import type { DiagnosticReport, DocumentReference, Observation, Patient, Reference } from '@medplum/fhirtypes';

/**
 * Bot: Parseo de PDF de laboratorio → DiagnosticReport + Observations
 *      ENRIQUECIDO con el catálogo de biomarcadores BioWellness.
 *
 * Se dispara por una Subscription al crearse/actualizarse un DocumentReference con PDF.
 * Llama a la API de Claude por `fetch` (SIN @anthropic-ai/sdk) para que el Bot quede
 * self-contained: en el runtime de Medplum solo está disponible @medplum/core, no
 * dependencias npm externas. Usa structured outputs (JSON Schema) para recibir los
 * analitos validados y los mapea a Observation + DiagnosticReport.
 *
 * Secret requerido en el Project: ANTHROPIC_API_KEY.
 */

interface LabItem {
  name: string;
  loincCode: string | null;
  valueNumber: number | null;
  valueText: string | null;
  unit: string | null;
  referenceRange: string | null;
  interpretation: 'low' | 'normal' | 'high' | 'abnormal' | 'unknown';
}

interface LabReport {
  reportDate: string | null;
  performer: string | null;
  observations: LabItem[];
}

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };

// JSON Schema para structured outputs (additionalProperties:false + todo en required).
const LAB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reportDate: NULLABLE_STRING,
    performer: NULLABLE_STRING,
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          loincCode: NULLABLE_STRING,
          valueNumber: NULLABLE_NUMBER,
          valueText: NULLABLE_STRING,
          unit: NULLABLE_STRING,
          referenceRange: NULLABLE_STRING,
          interpretation: { type: 'string', enum: ['low', 'normal', 'high', 'abnormal', 'unknown'] },
        },
        required: ['name', 'loincCode', 'valueNumber', 'valueText', 'unit', 'referenceRange', 'interpretation'],
      },
    },
  },
  required: ['reportDate', 'performer', 'observations'],
};

const EXTRACTION_PROMPT = `Sos un asistente clínico que extrae resultados de un PDF de laboratorio.
Devolvé únicamente los analitos presentes en el documento. No inventes valores.
Reglas:
- Un ítem por analito.
- valueNumber: el valor numérico (convertí coma decimal a punto). Si el resultado es cualitativo,
  dejá valueNumber en null y completá valueText (ej. "Positivo+", "No Contiene", "Escasas").
- unit: la unidad tal como figura (ej. "mg/dL").
- referenceRange: el rango de referencia textual si aparece.
- loincCode: solo si conocés el código LOINC con seguridad; si no, null.
- interpretation: low/normal/high/abnormal según el rango; unknown si no se puede determinar.
- reportDate en formato YYYY-MM-DD y performer (nombre del laboratorio) si están disponibles.
Si el PDF no contiene resultados de laboratorio, devolvé observations como lista vacía.`;

const INTERPRETATION: Record<string, { code: string; display: string }> = {
  low: { code: 'L', display: 'Low' },
  high: { code: 'H', display: 'High' },
  normal: { code: 'N', display: 'Normal' },
  abnormal: { code: 'A', display: 'Abnormal' },
};

function toFhirDate(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

async function extractWithClaude(apiKey: string, base64Pdf: string): Promise<LabReport> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      // Sin "thinking" para minimizar latencia (los Bots de Medplum tienen timeout).
      // structured outputs ya garantiza el esquema. Se puede reactivar adaptive thinking
      // si la extracción necesita más precisión y hay margen de tiempo.
      output_config: { format: { type: 'json_schema', schema: LAB_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude rechazó la solicitud (refusal).');
  }
  const text = data.content?.find((b) => b.type === 'text' && b.text)?.text;
  if (!text) {
    throw new Error('Claude no devolvió contenido de texto estructurado.');
  }
  return JSON.parse(text) as LabReport;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<DocumentReference>
): Promise<DiagnosticReport | undefined> {
  const docRef = event.input;

  // 1. PDF adjunto
  const attachment =
    docRef.content?.find((c) => c.attachment?.contentType === 'application/pdf')?.attachment ??
    docRef.content?.[0]?.attachment;

  // El front crea el DocumentReference sin URL y luego lo actualiza con el Binary.
  // En el evento "create" todavía no hay PDF: se omite (se procesa al actualizarse).
  if (!attachment?.url) {
    console.log('DocumentReference sin PDF adjunto todavía; se omite.');
    return undefined;
  }

  // Idempotencia: si ya generamos resultados para este documento, no reprocesar.
  const yaProcesado = await medplum.searchResources('Observation', {
    'derived-from': getReferenceString(docRef),
    _count: '1',
  });
  if (yaProcesado.length > 0) {
    console.log('Este DocumentReference ya fue procesado; se omite.');
    return undefined;
  }

  // 2. Descargar PDF
  const blob = await medplum.download(attachment.url);
  const base64Pdf = Buffer.from(await blob.arrayBuffer()).toString('base64');

  // 3. Extraer los datos con Claude (fetch directo).
  const apiKey = event.secrets['ANTHROPIC_API_KEY']?.valueString;
  if (!apiKey) {
    throw new Error('Falta el secret ANTHROPIC_API_KEY en el Project de Medplum.');
  }
  const report = await extractWithClaude(apiKey, base64Pdf);

  // En el portal de pacientes el subject es siempre un Patient.
  const subject = docRef.subject as Reference<Patient> | undefined;
  const effectiveDateTime = toFhirDate(report.reportDate) ?? docRef.date;
  const docRefReference = createReference(docRef);

  // 4. Una Observation por analito, enriquecida con el catálogo
  const resultRefs = [];
  for (const item of report.observations) {
    const cat = matchCatalog(catalog, item.name, item.loincCode);
    const loinc = cat?.loinc ?? item.loincCode ?? undefined;

    const observation: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [
        { coding: [{ system: SYS.obsCat, code: 'laboratory', display: 'Laboratory' }] },
        ...(cat?.panel ? [{ coding: [{ system: SYS.panel, code: cat.panel, display: cat.panelDisplay }] }] : []),
      ],
      code: { coding: loinc ? [{ system: SYS.loinc, code: loinc }] : undefined, text: item.name },
      subject,
      effectiveDateTime,
      derivedFrom: [docRefReference],
    };

    if (item.valueNumber !== null) {
      observation.valueQuantity = {
        value: item.valueNumber,
        ...(item.unit ? { unit: item.unit, system: SYS.ucum, code: item.unit } : {}),
      };
    } else if (item.valueText) {
      observation.valueString = item.valueText;
    }

    if (item.referenceRange) observation.referenceRange = [{ text: item.referenceRange }];

    const interp = INTERPRETATION[item.interpretation];
    if (interp) {
      observation.interpretation = [{ coding: [{ system: SYS.interp, code: interp.code, display: interp.display }] }];
    }

    // --- BioWellness: rango funcional óptimo desde el catálogo (sexo-específico) ---
    const opt = pickOptimal(cat?.optimal ?? [], sex);
    if (opt && (opt.low != null || opt.high != null)) {
      let fInterp: 'H' | 'L' | 'N' | undefined;
      if (item.valueNumber != null) {
        if (opt.low != null && item.valueNumber < opt.low) fInterp = 'L';
        else if (opt.high != null && item.valueNumber > opt.high) fInterp = 'H';
        else fInterp = 'N';
      }
      observation.extension = [{
        url: SYS.funcExt,
        extension: [
          ...(opt.low != null ? [{ url: 'low', valueQuantity: { value: opt.low, ...(item.unit ? { unit: item.unit, system: SYS.ucum, code: item.unit } : {}) } }] : []),
          ...(opt.high != null ? [{ url: 'high', valueQuantity: { value: opt.high, ...(item.unit ? { unit: item.unit, system: SYS.ucum, code: item.unit } : {}) } }] : []),
          ...(fInterp ? [{ url: 'interpretacion', valueCode: fInterp }] : []),
          { url: 'fuente', valueString: cat?.optimalText ? `Óptimo Medicina 3.0: ${cat.optimalText}` : 'Rango funcional óptimo (catálogo BioWellness)' },
        ],
      }] as any;
    }

    const created = await medplum.createResource(observation);
    resultRefs.push(createReference(created));
  }

  // 5. DiagnosticReport que agrupa las Observations
  const diagnosticReport: DiagnosticReport = {
    resourceType: 'DiagnosticReport',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }] }],
    code: { text: report.performer ? `Resultados de laboratorio — ${report.performer}` : 'Resultados de laboratorio' },
    subject,
    effectiveDateTime,
    issued: new Date().toISOString(),
    result: resultRefs,
    presentedForm: [attachment],
  };

  return medplum.createResource(diagnosticReport);
}
