import { Group, Text } from '@mantine/core';
import { IconActivityHeartbeat } from '@tabler/icons-react';
import type { JSX } from 'react';

/**
 * Wordmark de BioWellness: emblema circular ámbar + "Bio" (bold) + "Wellness" (regular),
 * para mantener la estética del portal del paciente.
 */
export function BrandLogo({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <Group gap={8} wrap="nowrap" align="center">
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size + 8,
          height: size + 8,
          borderRadius: '50%',
          background: '#c2711f',
          color: 'white',
          flexShrink: 0,
        }}
      >
        <IconActivityHeartbeat size={size - 6} stroke={2.5} />
      </span>
      <Text fz={size} fw={800} c="brand.9" style={{ letterSpacing: '-0.02em', lineHeight: 1 }}>
        Bio
        <Text span fw={500} c="brand.7">
          Wellness
        </Text>
      </Text>
    </Group>
  );
}
