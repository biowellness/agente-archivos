import { Alert, Button, FileInput, Stack, Textarea } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { DocumentReference, Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCheck, IconUpload, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';

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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    if (!file) {
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

      showNotification({
        color: 'teal',
        icon: <IconCheck size={16} />,
        title: 'Resultado enviado',
        message: `Se guardó correctamente. Un asistente lo procesará en breve. (ID: ${docRef.id})`,
      });
      setFile(null);
      setDescription('');
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
      <Alert color="teal" variant="light">
        Subí el PDF de tu resultado de laboratorio. Quedará en tu historia clínica electrónica y un asistente lo
        procesará automáticamente.
      </Alert>

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

      <Button
        onClick={() => {
          handleSubmit().catch(console.error);
        }}
        loading={submitting}
        disabled={!file}
        leftSection={<IconUpload size={16} />}
      >
        Enviar resultado
      </Button>
    </Stack>
  );
}
