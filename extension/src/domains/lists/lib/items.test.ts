import { describe, expect, it } from 'vitest';

import { groupByMonth, parseBulkTitles } from './items';

describe('parseBulkTitles', () => {
  it('drops blank lines and list markers', () => {
    expect(parseBulkTitles('x'.repeat(300))).toEqual(['x'.repeat(200)]); // the Worker caps titles at 200
    expect(parseBulkTitles('1. Матрица\n\n  - Троя  \n• Чужой\n2) Титаник\nБегущий по лезвию 2049')).toEqual([
      'Матрица',
      'Троя',
      'Чужой',
      'Титаник',
      'Бегущий по лезвию 2049',
    ]);
  });
});

describe('groupByMonth', () => {
  it('groups consecutive items by month', () => {
    const items = [
      { watched_at: new Date(2026, 8, 28).getTime() },
      { watched_at: new Date(2026, 8, 2).getTime() },
      { watched_at: new Date(2026, 7, 30).getTime() },
    ];
    const groups = groupByMonth(items, 'ru');
    expect(groups.map((group) => [group.title, group.items.length])).toEqual([
      ['сентябрь 2026', 2],
      ['август 2026', 1],
    ]);
  });
});
