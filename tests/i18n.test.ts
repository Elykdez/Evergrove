import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json';
import zhCN from '../src/locales/zh-CN.json';
import { LANGUAGES, matchLanguage, pickLanguage, resources, supportedLanguage } from '../src/i18n';
import { PRESETS } from '../src/presets';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Plural forms differ per language (en: one/other, zh: other), so compare base keys. */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (flat: Record<string, string>) => new Set(Object.keys(flat).map((k) => k.replace(PLURAL, '')));
const placeholders = (s: string) =>
  [...s.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).filter((p) => p !== 'count').sort();

const reference = flatten(en);

describe('locales', () => {
  it.each(LANGUAGES)('%s has exactly the reference keys', (lng) => {
    const flat = flatten(resources[lng].translation as Tree);
    expect([...baseKeys(flat)].sort()).toEqual([...baseKeys(reference)].sort());
    for (const [k, v] of Object.entries(flat)) expect(v.trim(), k).not.toBe('');
  });

  it.each(LANGUAGES)('%s keeps every interpolation placeholder', (lng) => {
    const flat = flatten(resources[lng].translation as Tree);
    for (const [k, v] of Object.entries(flat)) {
      const ref = reference[k] ?? reference[k.replace(PLURAL, '_other')];
      expect(placeholders(v), k).toEqual(placeholders(ref));
    }
  });

  it('names every preset in every language', () => {
    for (const lng of LANGUAGES) {
      const names = resources[lng].translation.presets as Record<string, string>;
      for (const preset of Object.keys(PRESETS)) expect(names[preset], `${lng}: ${preset}`).toBeTruthy();
    }
  });

  it('gives each language a distinct self-name for the picker', () => {
    const names = LANGUAGES.map((l) => resources[l].translation.language.name);
    expect(new Set(names).size).toBe(LANGUAGES.length);
  });
});

describe('language matching', () => {
  it('folds Chinese variants onto zh-CN and unknown tags onto en', () => {
    expect(matchLanguage('zh')).toBe('zh-CN');
    expect(matchLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLanguage('en-GB')).toBe('en');
    expect(matchLanguage('fr-FR')).toBe('en');
    expect(supportedLanguage('fr-FR')).toBeUndefined();
    expect(supportedLanguage('zhuang')).toBeUndefined();
  });

  it('picks the first browser language we ship, else English', () => {
    expect(pickLanguage(['zh-TW', 'en-US'])).toBe('zh-CN');
    expect(pickLanguage(['en-GB', 'zh-CN'])).toBe('en');
    expect(pickLanguage(['fr-FR', 'de', 'zh-Hans'])).toBe('zh-CN');
    expect(pickLanguage(['fr-FR', 'de'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('resolves plurals and number formatting per language', async () => {
    const t = i18next.createInstance();
    await t.init({ resources, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } });
    expect(t.t('hud.fruit', { count: 1 })).toBe('1 fruit');
    expect(t.t('hud.fruit', { count: 3 })).toBe('3 fruits');
    expect(t.t('batch.cancel', { done: 2, total: 9 })).toBe('Cancel (2 / 9)');
    await t.changeLanguage('zh-CN');
    expect(t.t('hud.fruit', { count: 1 })).toBe(zhCN.hud.fruit_other.replace('{{count, number}}', '1'));
    expect(t.t('hud.value', { value: 74145 })).toBe('74,145');
  });
});
