import { Button, Paper, Stack, Text, Title } from '@mantine/core';
import { Document } from '@medplum/react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';

export function LandingPage(): JSX.Element {
  return (
    <Document width={460}>
      <Stack gap="lg">
        <BrandLogo size={28} />
        <Paper radius="lg" p="xl" bg="brand.9" c="white">
          <Title order={3} c="white">
            Cargá tus resultados
          </Title>
          <Text mt="xs" size="sm" c="gray.3">
            Enviá los PDF de tu laboratorio y quedan en tu historia clínica electrónica. Vos sos el dueño de tus
            datos: solo se comparten con tu autorización.
          </Text>
          <Button component={Link} to="/signin" variant="white" color="dark" mt="lg">
            Ingresar
          </Button>
        </Paper>
      </Stack>
    </Document>
  );
}
