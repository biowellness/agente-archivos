import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';

const medplum = new MedplumClient({
  baseUrl: import.meta.env.MEDPLUM_BASE_URL,
  onUnauthenticated: () => (window.location.href = '/'),
});

// Paleta marrón espresso/cacao de BioWellness (crema → espresso).
const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 8, dark: 8 },
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontWeight: '700',
  },
  colors: {
    brand: [
      '#f7f2ee',
      '#ead9cd',
      '#d8b9a4',
      '#c6997b',
      '#b67e5a',
      '#ab6e48',
      '#8f5638',
      '#74452d',
      '#573322',
      '#3e2419',
    ],
  },
  components: {
    Button: { defaultProps: { radius: 'xl' } },
    Paper: { defaultProps: { radius: 'lg' } },
  },
});

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <BrowserRouter>
      <MedplumProvider medplum={medplum}>
        <MantineProvider theme={theme}>
          <Notifications />
          <App />
        </MantineProvider>
      </MedplumProvider>
    </BrowserRouter>
  </StrictMode>
);
