import { Button, Checkbox, FileInput, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Consent, DocumentReference, Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCheck, IconUpload, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';

const CONSENT_TEXT =
  'Autorizo el envío de este resultado de laboratorio y su procesamiento para incorporarlo a mi historia clínica electrónica.';

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Formulario de carga de un PDF de resultados de laboratorio.
 *
 * Sube el archivo como Binary y crea el DocumentReference asociado en una sola
 * llamada (medplum.createDocumentReference). El subject es el paciente logueado.
 * El procesamiento (parseo del PDF) lo hace luego un Bot vía Subscription (Paso 3).
 */
export function UploadLabReport(): JSX.Element {
  const medplum = useMedplum();
  // En el portal de pacientes, el profile suele ser un Patient.
  const profile = useMedplumProfile() as Patient;

  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    if (!file || !consent) {
      return;
    }
    if (file.type !== 'application/pdf') {
      showNotification({ color: 'red', icon: <IconX size={16} />, message: 'El archivo debe ser un PDF.' });
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      showNotification({ color: 'red', icon: <IconX size={16} />, message: 'El PDF supera el máximo de 25 MB.' });
      return;
    }

    setSubmitting(true);
    try {
      const docRef = await medplum.createDocumentReference({
        data: file,
        contentType: 'application/pdf',
        filename: file.name,
        additionalFields: {
          status: 'current',
          type: {
            coding: [{ system: 'http://loinc.org', code: '11502-2', display: 'Laboratory report' }],
            text: 'Resultado de laboratorio',
          },
          category: [
            {
              coding: [{ system: 'http://loinc.org', code: '26436-6', display: 'Laboratory studies (set)' }],
            },
          ],
          subject: createReference(profile),
          date: new Date().toISOString(),
          description: description.trim() || undefined,
        } satisfies Omit<Partial<DocumentReference>, 'content'>,
      });

      // Consentimiento explícito del paciente, vinculado a este documento.
      await medplum.createResource<Consent>({
        resourceType: 'Consent',
        status: 'active',
        scope: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/consentscope',
              code: 'patient-privacy',
              display: 'Privacy Consent',
            },
          ],
        },
        category: [
          { coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Consent Document' }] },
        ],
        patient: createReference(profile),
        dateTime: new Date().toISOString(),
        performer: [createReference(profile)],
        sourceReference: createReference(docRef),
        policyRule: { text: CONSENT_TEXT },
        provision: {
          type: 'permit',
          data: [{ meaning: 'instance', reference: createReference(docRef) }],
        },
      });

      showNotification({
        color: 'teal',
        icon: <IconCheck size={16} />,
        title: 'Resultado enviado',
        message: `Se guardó correctamente con tu consentimiento. Un asistente lo procesará en breve. (ID: ${docRef.id})`,
      });
      setFile(null);
      setDescription('');
      setConsent(false);
    } catch (err) {
      showNotification({
        color: 'red',
        icon: <IconX size={16} />,
        title: 'No se pudo enviar',
        message: normalizeErrorString(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md" maw={540}>
      <Paper radius="lg" p="lg" bg="brand.9" c="white">
        <Title order={4} c="white">
          Cargá tu resultado
        </Title>
        <Text mt={6} size="sm" c="gray.3">
          Subí el PDF de tu laboratorio. Queda en tu historia clínica electrónica y un asistente lo procesa
          automáticamente.
        </Text>
      </Paper>

      <FileInput
        label="Archivo PDF"
        placeholder="Elegí tu resultado (.pdf)"
        accept="application/pdf"
        leftSection={<IconUpload size={16} />}
        value={file}
        onChange={setFile}
        clearable
        required
      />

      <Textarea
        label="Descripción (opcional)"
        placeholder="Ej: Análisis de sangre — 12/06/2026"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        autosize
        minRows={2}
      />

      <Checkbox
        checked={consent}
        onChange={(e) => setConsent(e.currentTarget.checked)}
        label={CONSENT_TEXT}
      />

      <Button
        onClick={() => {
          handleSubmit().catch(console.error);
        }}
        loading={submitting}
        disabled={!file || !consent}
        leftSection={<IconUpload size={16} />}
        size="md"
        fullWidth
      >
        Enviar resultado
      </Button>
    </Stack>
  );
}
