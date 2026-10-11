import { describe, expect, it } from 'vitest';

import en from '@assets/i18n/locales/en.json';
import ru from '@assets/i18n/locales/ru.json';

import { pickOnColor, PRESETS } from './presets';
import styles from './styles.css?raw';

/** Every key of a locale, plural forms folded into one ("seasons_one" → "seasons"). */
const keys = (node: object, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key.replace(/_(one|few|many|other)$/, '')}`],
  );

describe('presets', () => {
  it('have a name and a hint in both languages, none named after Twitch', () => {
    for (const locale of [en, ru]) {
      expect(Object.keys(locale.appearance.presets).sort()).toEqual(Object.keys(PRESETS).sort());
      for (const { name, hint } of Object.values(locale.appearance.presets)) {
        expect(name).toBeTruthy();
        expect(hint).toBeTruthy();
        expect(name).not.toMatch(/twitch/i);
      }
    }
  });

  it('paint the page before any JS runs: :root in styles.css is the default preset', () => {
    const root = styles.match(/:root \{([^}]*)\}/)![1];
    const value = (name: string) => root.match(new RegExp(`--${name}: ([^;]+);`))![1];
    const { bg, primaryHi, primaryLo, accent } = PRESETS.fox;
    expect([value('bg'), value('primary-hi'), value('primary-lo'), value('accent')]).toEqual([bg, primaryHi, primaryLo, accent]);
  });

  it('pick dark button text on a light own color, white on a dark one', () => {
    expect(pickOnColor('#ffffff')).not.toBe('#fff');
    expect(pickOnColor('#ffe600')).not.toBe('#fff');
    expect(pickOnColor('#8ff5d6')).not.toBe('#fff');
    expect(pickOnColor('#140b1f')).toBe('#fff');
    expect(pickOnColor('#772ce8')).toBe('#fff');
  });
});

describe('locales', () => {
  it('have the same keys in Russian and English', () => {
    expect([...new Set(keys(ru))].sort()).toEqual([...new Set(keys(en))].sort());
  });

  it('have no Russian left in English', () => {
    expect(JSON.stringify(en)).not.toMatch(/[А-Яа-яЁё]/);
  });
});
