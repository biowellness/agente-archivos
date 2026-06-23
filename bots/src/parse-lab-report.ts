import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BotEvent, MedplumClient, createReference } from '@medplum/core';
import type {
  DiagnosticReport, DocumentReference, Observation, ObservationDefinition, Patient, Reference,
} from '@medplum/fhirtypes';
import * as z from 'zod/v4';

/**
 * Bot: Parseo de PDF de laboratorio → DiagnosticReport + Observations
 *      ENRIQUECIDO con el catálogo de biomarcadores BioWellness.
 *
 * Drop-in para reemplazar bots/src/parse-lab-report.ts en biowellness/agente-archivos.
 * Conserva la extracción robusta del repo (Anthropic SDK + structured outputs Zod,
 * claude-opus-4-8) y le agrega la capa BioWellness:
 *   - match de cada analito contra las ObservationDefinition sembradas (por LOINC, luego nombre),
 *   - category de panel (panel-biomarcador),
 *   - extensión 'rango-funcional' con el óptimo Medicina 3.0 (sexo-específico),
 *   manteniendo el referenceRange del propio laboratorio.
 *
 * Secret requerido en el Project: ANTHROPIC_API_KEY.
 */

// ====================== Convenciones FHIR BioWellness ======================
const BIO = 'https://bio.medplum.com.ar/fhir';
const SYS = {
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org',
  interp: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
  obsCat: 'http://terminology.hl7.org/CodeSystem/observation-category',
  panel: `${BIO}/CodeSystem/panel-biomarcador`,
  funcExt: `${BIO}/StructureDefinition/rango-funcional`,
};

// ====================== Esquema de extracción (igual que el repo) ======================
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
- Un ítem por analito (incluí los componentes del hemograma: % y valores absolutos).
- valueNumber: el valor numérico. Si el resultado es cualitativo, dejá valueNumber en null y completá valueText.
- unit: la unidad tal como figura.
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

// ====================== Capa de catálogo BioWellness ======================
interface CatInterval { gender?: 'male' | 'female'; low?: number; high?: number; }
interface CatEntry {
  name: string; loinc?: string; panel?: string; panelDisplay?: string;
  optimal: CatInterval[]; optimalText?: string;
}

function normName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[():.]/g, '').replace(/\s+/g, ' ').trim();
}

// Alias nombre-de-laboratorio → nombre-de-catálogo (fallback cuando no hay LOINC)
const ALIAS: Record<string, string> = {
  'glucemia': 'glucosa en ayunas', 'colesterol hdl': 'hdl colesterol', 'colesterol ldl': 'ldl colesterol',
  'colesterol ldl friedewald': 'ldl colesterol', 'trigliceridemia': 'trigliceridos', 'uricemia': 'acido urico',
  'creatininemia': 'creatinina', 'apolipoproteina b': 'apob', 'vitamina b 12 cianocobalamina': 'vitamina b12',
  'vitamina b12 cianocobalamina': 'vitamina b12', 'pcr cuantitativa': 'pcr ultrasensible hs-crp',
  'shbg globulina ligadora de hormonas sexuales': 'shbg', 't4l-tiroxina libre': 't4 libre',
  't3 libre - triiodotironina libre': 't3 libre', 'filtrado glomerular estimado ckd-epi 2021': 'egfr tfg estimada',
  'ifge': 'egfr tfg estimada', 'zinc en suero': 'zinc',
};

async function loadCatalog(medplum: MedplumClient): Promise<{ byLoinc: Map<string, CatEntry>; byName: Map<string, CatEntry> }> {
  const ods = await medplum.searchResources('ObservationDefinition', { _count: '200' });
  const byLoinc = new Map<string, CatEntry>();
  const byName = new Map<string, CatEntry>();
  for (const od of ods) {
    const loinc = od.code?.coding?.find((c) => c.system === SYS.loinc)?.code;
    const panelCoding = od.category?.[0]?.coding?.[0];
    const optimal: CatInterval[] = (od.qualifiedInterval ?? [])
      .filter((qi) => (qi.context as any)?.coding?.[0]?.code === 'funcional-optimo')
      .map((qi) => ({ gender: qi.gender as any, low: qi.range?.low?.value, high: qi.range?.high?.value }));
    const optimalText = (od.extension ?? []).find((e) => e.url === `${BIO}/StructureDefinition/rango-optimo-texto`)?.valueString;
    const entry: CatEntry = {
      name: od.code?.text ?? '', loinc, panel: panelCoding?.code, panelDisplay: panelCoding?.display, optimal, optimalText,
    };
    if (loinc) byLoinc.set(loinc, entry);
    if (entry.name) byName.set(normName(entry.name), entry);
  }
  return { byLoinc, byName };
}

function matchCatalog(idx: { byLoinc: Map<string, CatEntry>; byName: Map<string, CatEntry> }, name: string, loinc?: string | null): CatEntry | undefined {
  if (loinc && idx.byLoinc.has(loinc)) return idx.byLoinc.get(loinc);
  const n = normName(name);
  if (idx.byName.has(n)) return idx.byName.get(n);
  const alias = ALIAS[n];
  if (alias && idx.byName.has(alias)) return idx.byName.get(alias);
  for (const [k, v] of idx.byName) if (n.includes(k) || k.includes(n)) return v;
  return undefined;
}

function pickOptimal(optimal: CatInterval[], sex?: string): CatInterval | undefined {
  if (!optimal.length) return undefined;
  if (sex === 'male' || sex === 'female') {
    const g = optimal.find((i) => i.gender === sex);
    if (g) return g;
  }
  return optimal.find((i) => !i.gender) ?? optimal[0];
}

// ====================== Handler ======================
export async function handler(medplum: MedplumClient, event: BotEvent<DocumentReference>): Promise<DiagnosticReport> {
  const docRef = event.input;

  // 1. PDF adjunto
  const attachment =
    docRef.content?.find((c) => c.attachment?.contentType === 'application/pdf')?.attachment ??
    docRef.content?.[0]?.attachment;
  if (!attachment?.url) throw new Error('El DocumentReference no tiene un PDF adjunto.');

  // 2. Descargar PDF
  const blob = await medplum.download(attachment.url);
  const base64Pdf = Buffer.from(await blob.arrayBuffer()).toString('base64');

  // 3. Extracción (Claude) + catálogo + paciente, en paralelo
  const apiKey = event.secrets['ANTHROPIC_API_KEY']?.valueString;
  if (!apiKey) throw new Error('Falta el secret ANTHROPIC_API_KEY en el Project de Medplum.');
  const anthropic = new Anthropic({ apiKey });
  const subject = docRef.subject as Reference<Patient> | undefined;

  const [response, catalog, patient] = await Promise.all([
    anthropic.messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(LabReport) },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    }),
    loadCatalog(medplum),
    subject ? medplum.readReference(subject).catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const report = response.parsed_output;
  if (!report) throw new Error('Claude no devolvió datos estructurados.');

  const sex = (patient as Patient | undefined)?.gender;
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
