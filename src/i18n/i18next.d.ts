import 'i18next';
import type en from '../locales/en.json';

// Types i18next.t() keys against the English file, so a mistyped key fails typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
