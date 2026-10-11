import { describe, expect, it, vi } from 'vitest';

import { dragQueueOrder, formatDay, groupByMonth, matchesTitle, parseBulkTitles, reorderInPlace, requeueIndex } from './items';

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

  it('drops control characters and does not cut an emoji in half', () => {
    expect(parseBulkTitles('\u0007\nМат\u0007рица')).toEqual(['Матрица']);
    expect(parseBulkTitles(`${'a'.repeat(199)}😀😀`)).toEqual([`${'a'.repeat(199)}😀`]);
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

describe('formatDay', () => {
  it('makes one date format per language', () => {
    const constructor = vi.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 50; i++) formatDay(Date.now(), 'de');
    formatDay(Date.now(), 'fr');
    expect(constructor).toHaveBeenCalledTimes(2);
    constructor.mockRestore();
  });
});

describe('matchesTitle', () => {
  it('ignores case, ё/е and extra spaces', () => {
    expect(matchesTitle('Ёлки  2', ' елки 2')).toBe(true);
    expect(matchesTitle('Ёлки', 'палки')).toBe(false);
  });
});

describe('queue order', () => {
  const queue = [
    { id: 1, points: 100 },
    { id: 2, points: 40 },
    { id: 3, points: null },
    { id: 4, points: null },
    { id: 5, points: null },
  ];

  it('drags among titles without a bid, never onto one with a bid', () => {
    expect(dragQueueOrder(queue, 5, 3)).toEqual([1, 2, 5, 3, 4]);
    expect(dragQueueOrder(queue, 5, 1)).toBeNull();
    expect(dragQueueOrder(queue, 3, 3)).toBeNull();
  });

  it('reorders the shown part of the queue in the places it holds', () => {
    // A search shows 3 and 5; 5 is dragged above 3.
    expect(reorderInPlace(queue, [5, 3]).map((item) => item.id)).toEqual([1, 2, 5, 4, 3]);
    expect(reorderInPlace(queue, [5, 4, 3, 99]).map((item) => item.id)).toEqual([1, 2, 5, 4, 3]);
  });

  it('puts a requeued item after every title with the same or a bigger bid', () => {
    expect(requeueIndex(queue, 60)).toBe(1);
    expect(requeueIndex(queue, 40)).toBe(2);
    expect(requeueIndex(queue, null)).toBe(5);
  });
});
