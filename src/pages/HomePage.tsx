import { Stack, Text, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import { Document, ResourceName, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { UploadLabReport } from '../components/UploadLabReport';

export function HomePage(): JSX.Element {
  // El "profile" del usuario logueado. En el portal de pacientes suele ser un Patient.
  const profile = useMedplumProfile() as Patient;

  return (
    <Document>
      <Stack gap="lg">
        <Stack gap={2}>
          <Text c="dimmed" fz="sm">
            Hola,
          </Text>
          <Title order={2}>
            <ResourceName value={profile} />
          </Title>
        </Stack>
        <UploadLabReport />
      </Stack>
    </Document>
  );
}
