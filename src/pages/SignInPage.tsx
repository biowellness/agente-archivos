import { SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { SignInForm } from '@medplum/react';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { MEDPLUM_PROJECTS } from '../config';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();

  // El paciente elige la institución; cada una es un Project FHIR en el servidor.
  const [projectId, setProjectId] = useState<string>(MEDPLUM_PROJECTS[0]?.id ?? '');

  return (
    <SignInForm
      // projectId scopea el login a la institución elegida.
      projectId={projectId || undefined}
      // Login con Google (además de email + contraseña, que SignInForm renderiza solo).
      googleClientId={import.meta.env.GOOGLE_CLIENT_ID}
      clientId={import.meta.env.MEDPLUM_CLIENT_ID}
      onSuccess={() => navigate('/')?.catch(console.error)}
    >
      <BrandLogo size={28} />
      <Title order={3}>Ingresar</Title>

      {MEDPLUM_PROJECTS.length > 1 && (
        <Stack gap={4} w="100%">
          <Text size="sm" fw={500} ta="center">
            Elegí tu institución
          </Text>
          <SegmentedControl
            fullWidth
            value={projectId}
            onChange={setProjectId}
            data={MEDPLUM_PROJECTS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Stack>
      )}
    </SignInForm>
  );
}
