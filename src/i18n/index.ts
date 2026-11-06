import i18next from 'i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import { log, logWarn } from '../log';

/** One JSON file per language in src/locales; en is the reference every other file must match. */
export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const;

export type Language = keyof typeof resources;
export const LANGUAGES = Object.keys(resources) as Language[];

/** Each language's name for itself, read from its own file so the picker needs no hard-coded labels. */
export function languageNames(): Record<string, Language> {
  return Object.fromEntries(LANGUAGES.map((l) => [resources[l].translation.language.name, l]));
}

/**
 * The shipped language a BCP 47 tag belongs to, folding regional variants onto it
 * (zh, zh-Hans, zh-SG -> zh-CN; en-GB -> en), or undefined when we don't ship it.
 */
export function supportedLanguage(tag: string): Language | undefined {
  const lower = tag.trim().toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
  return LANGUAGES.find((l) => l.toLowerCase() === lower || lower.startsWith(`${l.toLowerCase()}-`));
}

/** Like supportedLanguage, but unknown tags fall back to English. */
export function matchLanguage(tag: string): Language {
  return supportedLanguage(tag) ?? 'en';
}

/**
 * The first of the browser's preferred languages (navigator.languages, in the user's order)
 * that we ship, or English when none is. fr, zh-CN gives zh-CN; fr, de gives en.
 */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const lang = supportedLanguage(tag);
    if (lang) return lang;
  }
  return 'en';
}

/** Only an explicit pick in the panel is stored, so the browser setting applies until then. */
const STORAGE_KEY = 'evergrove.language';

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Storage blocked (private mode, sandboxed frame).
  }
}

/** Remembers a language the user picked in the panel. */
export function rememberLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    // Not remembered; the browser setting applies next time.
    logWarn('i18n', `Storage blocked; language ${lang} is not remembered.`, e);
  }
}

/**
 * Start-up language: ?lang= in the URL, then the language picked in the panel before, then the
 * browser's preferred languages, then English.
 */
function detectLanguage(): Language {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const explicit = fromUrl ?? storedLanguage();
  const chosen = explicit ? supportedLanguage(explicit) : undefined;
  if (chosen) {
    log('i18n', `Language ${chosen} from ${fromUrl ? '?lang=' : 'the saved pick'}.`);
    return chosen;
  }
  if (explicit) logWarn('i18n', `Language '${explicit}' is not shipped; using the browser languages.`);
  const browser = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  const lang = pickLanguage(browser);
  log('i18n', `Language ${lang} from the browser languages [${browser.join(', ')}].`);
  return lang;
}

/** Resources are bundled, so this is synchronous. */
export function initI18n() {
  void i18next.init({
    resources,
    lng: detectLanguage(),
    initAsync: false,
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    load: 'currentOnly',
    // Strings are only ever assigned through textContent or canvas text, never innerHTML.
    interpolation: { escapeValue: false },
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_lngs, _ns, key) => logWarn('i18n', `Missing key: ${key}`),
  });
}

export function currentLanguage(): Language {
  return matchLanguage(i18next.resolvedLanguage ?? 'en');
}

/** For keys built at runtime (preset names, option values, parameter paths). */
export function tKey(key: string, options?: Record<string, unknown>): string {
  return (i18next.t as (key: string, options?: Record<string, unknown>) => string)(key, options);
}

/** Fills every [data-i18n] element and the document title and language. */
export function translateDocument() {
  document.documentElement.lang = currentLanguage();
  document.title = i18next.t('app.title');
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = tKey(el.dataset.i18n!);
  });
}

export { i18next };
