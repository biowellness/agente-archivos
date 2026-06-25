import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BotEvent, MedplumClient, createReference, getReferenceString } from '@medplum/core';
import type { DiagnosticReport, DocumentReference, Observation, Patient, Reference } from '@medplum/fhirtypes';
import * as z from 'zod/v4';

/**
 * Bot: Parseo de PDF de laboratorio → DiagnosticReport + Observations.
 *
 * Se dispara por una Subscription cuando se crea un DocumentReference con un PDF.
 * 1. Descarga el PDF (Binary) del DocumentReference.
 * 2. Se lo manda a Claude (modelo claude-opus-4-8) como documento nativo.
 * 3. Claude devuelve los analitos en JSON validado (structured outputs).
 * 4. El Bot crea una Observation por analito y un DiagnosticReport que las agrupa,
 *    todo vinculado al paciente (subject del DocumentReference).
 *
 * Secret requerido en el Project de Medplum: ANTHROPIC_API_KEY.
 */

// --- Esquema de extracción (lo que pedimos a Claude) ---
const ObservationItem = z.object({
  name: z.string().describe('Nombre del analito tal como aparece en el PDF (ej. "Glucosa")'),
  loincCode: z.string().nullable().describe('Código LOINC solo si es seguro; de lo contrario null'),
  valueNumber: z.number().nullable().describe('Valor numérico; null si el resultado es cualitativo'),
  valueText: z.string().nullable().describe('Valor cualitativo/textual (ej. "Positivo"); null si es numérico'),
  unit: z.string().nullable().describe('Unidad tal como figura (ej. "mg/dL")'),
  referenceRange: z.string().nullable().describe('Rango de referencia textual si aparece'),
  interpretation: z
    .enum(['low', 'normal', 'high', 'abnormal', 'unknown'])
    .describe('Interpretación respecto del rango de referencia'),
});

const LabReport = z.object({
  reportDate: z.string().nullable().describe('Fecha del informe en formato YYYY-MM-DD si está disponible'),
  performer: z.string().nullable().describe('Nombre del laboratorio que emite el informe'),
  observations: z.array(ObservationItem),
});

const EXTRACTION_PROMPT = `Sos un asistente clínico que extrae resultados de un PDF de laboratorio.
Devolvé únicamente los analitos presentes en el documento. No inventes valores.
Reglas:
- Un ítem por analito.
- valueNumber: el valor numérico. Si el resultado es cualitativo, dejá valueNumber en null y completá valueText.
- unit: la unidad tal como figura.
- referenceRange: el rango de referencia textual si aparece.
- loincCode: solo si conocés el código LOINC con seguridad; si no, null.
- interpretation: low/normal/high/abnormal según el rango; unknown si no se puede determinar.
- reportDate en formato YYYY-MM-DD y performer (nombre del laboratorio) si están disponibles.
Si el PDF no contiene resultados de laboratorio, devolvé observations como lista vacía.`;

// Mapeo a los códigos FHIR de interpretación (HL7 v3 ObservationInterpretation).
const INTERPRETATION: Record<string, { code: string; display: string }> = {
  low: { code: 'L', display: 'Low' },
  high: { code: 'H', display: 'High' },
  normal: { code: 'N', display: 'Normal' },
  abnormal: { code: 'A', display: 'Abnormal' },
};

function toFhirDate(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<DocumentReference>
): Promise<DiagnosticReport | undefined> {
  const docRef = event.input;

  // 1. Localizar el PDF adjunto.
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

  // 2. Descargar el PDF y pasarlo a base64.
  const blob = await medplum.download(attachment.url);
  const base64Pdf = Buffer.from(await blob.arrayBuffer()).toString('base64');

  // 3. Extraer los datos con Claude.
  const apiKey = event.secrets['ANTHROPIC_API_KEY']?.valueString;
  if (!apiKey) {
    throw new Error('Falta el secret ANTHROPIC_API_KEY en el Project de Medplum.');
  }
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(LabReport) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const report = response.parsed_output;
  if (!report) {
    throw new Error('Claude no devolvió datos estructurados.');
  }

  // En el portal de pacientes el subject es siempre un Patient (el DocumentReference
  // lo tipa más amplio, así que lo acotamos para Observation/DiagnosticReport).
  const subject = docRef.subject as Reference<Patient> | undefined;
  const effectiveDateTime = toFhirDate(report.reportDate) ?? docRef.date;
  const docRefReference = createReference(docRef);

  // 4. Crear una Observation por analito.
  const resultRefs = [];
  for (const item of report.observations) {
    const observation: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
              display: 'Laboratory',
            },
          ],
        },
      ],
      code: {
        coding: item.loincCode ? [{ system: 'http://loinc.org', code: item.loincCode }] : undefined,
        text: item.name,
      },
      subject,
      effectiveDateTime,
      derivedFrom: [docRefReference],
    };

    if (item.valueNumber !== null) {
      observation.valueQuantity = { value: item.valueNumber, unit: item.unit ?? undefined };
    } else if (item.valueText) {
      observation.valueString = item.valueText;
    }
    if (item.referenceRange) {
      observation.referenceRange = [{ text: item.referenceRange }];
    }
    const interp = INTERPRETATION[item.interpretation];
    if (interp) {
      observation.interpretation = [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
              code: interp.code,
              display: interp.display,
            },
          ],
        },
      ];
    }

    const created = await medplum.createResource(observation);
    resultRefs.push(createReference(created));
  }

  // 5. Crear el DiagnosticReport que agrupa las Observations.
  const diagnosticReport: DiagnosticReport = {
    resourceType: 'DiagnosticReport',
    status: 'final',
    category: [
      {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' },
        ],
      },
    ],
    code: {
      text: report.performer
        ? `Resultados de laboratorio — ${report.performer}`
        : 'Resultados de laboratorio',
    },
    subject,
    effectiveDateTime,
    issued: new Date().toISOString(),
    result: resultRefs,
    presentedForm: [attachment],
  };

  return medplum.createResource(diagnosticReport);
}
