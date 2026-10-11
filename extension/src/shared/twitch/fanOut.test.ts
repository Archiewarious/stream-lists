import { describe, expect, it, vi } from 'vitest';

import { fanOut } from './fanOut';

describe('fanOut', () => {
  it('subscribes to Twitch once, replays the last value to late listeners and lets them go', () => {
    let emit: (value: string) => void = () => {};
    const subscribeOnce = vi.fn((next: (value: string) => void) => {
      emit = next;
    });
    const subscribe = fanOut(subscribeOnce);
    const first = vi.fn();
    const second = vi.fn();

    subscribe(first);
    emit('t1');
    const unsubscribe = subscribe(second);
    expect(second).toHaveBeenCalledWith('t1');
    emit('t2');
    expect(first.mock.calls).toEqual([['t1'], ['t2']]);
    expect(second.mock.calls).toEqual([['t1'], ['t2']]);

    unsubscribe();
    emit('t3');
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(3);
    expect(subscribeOnce).toHaveBeenCalledTimes(1);
  });
});
