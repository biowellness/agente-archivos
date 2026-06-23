/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MEDPLUM_BASE_URL: string;
  readonly MEDPLUM_CLIENT_ID?: string;
  readonly MEDPLUM_PROJECT_ID_BIO?: string;
  readonly MEDPLUM_PROJECT_ID_RECEPCION?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly RECAPTCHA_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
