import type { MessageSchema } from './locales/tr';

// Typed message keys for `t()` autocompletion; `en.ts` is checked against the same schema.
declare module 'vue-i18n' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefineLocaleMessage extends MessageSchema {}
}
