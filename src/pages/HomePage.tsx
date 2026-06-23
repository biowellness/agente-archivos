import { Stack, Text, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import { Document, ResourceName, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';

export function HomePage(): JSX.Element {
  // El "profile" del usuario logueado. En el portal de pacientes suele ser un Patient.
  const profile = useMedplumProfile() as Patient;

  return (
    <Document>
      <Stack gap="sm">
        <Title order={2}>
          Hola <ResourceName value={profile} /> 👋
        </Title>
        <Text>Desde acá vas a poder enviar los PDF de tus resultados de laboratorio.</Text>
        <Text c="dimmed" size="sm">
          Próximamente: carga de archivos (Paso 2 — DocumentReference).
        </Text>
      </Stack>
    </Document>
  );
}
