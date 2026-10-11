/**
 * One subscription to a Twitch.ext callback shared by every listener of ours: Twitch.ext.onAuthorized keeps only the
 * LAST callback (a second call silently disconnects the first), and the same is assumed of configuration.onChanged.
 * A late listener gets the last value at once. Returns subscribe(listener) → unsubscribe.
 */
export const fanOut = <T>(subscribeOnce: (emit: (value: T) => void) => void) => {
  const listeners = new Set<(value: T) => void>();
  let last: { value: T } | undefined;
  let isSubscribed = false;

  return (listener: (value: T) => void) => {
    listeners.add(listener);
    if (last) listener(last.value);
    if (!isSubscribed) {
      isSubscribed = true;
      subscribeOnce((value) => {
        last = { value };
        listeners.forEach((each) => each(value));
      });
    }
    return () => {
      listeners.delete(listener);
    };
  };
};
