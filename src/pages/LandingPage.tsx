import { Button, Stack, Text, Title } from '@mantine/core';
import { Document } from '@medplum/react';
import type { JSX } from 'react';
import { Link } from 'react-router';

export function LandingPage(): JSX.Element {
  return (
    <Document width={520}>
      <Stack align="center" gap="md">
        <Title order={2}>Agente Archivos</Title>
        <Text ta="center">
          Enviá los PDF de tus resultados de laboratorio para que queden en tu historia clínica electrónica
          interoperable. Vos sos el dueño de tus datos: solo se comparten con tu autorización.
        </Text>
        <Button component={Link} to="/signin" size="md">
          Ingresar
        </Button>
      </Stack>
    </Document>
  );
}
