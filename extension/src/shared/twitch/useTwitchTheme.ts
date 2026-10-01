import { useEffect, useState } from 'react';

import { twitchApi, type TwitchTheme } from '@shared/twitch/twitchApi';

/** Follows the viewer's Twitch theme so the extension matches the channel page. */
export const useTwitchTheme = (): TwitchTheme => {
  const [theme, setTheme] = useState<TwitchTheme>('dark');

  useEffect(() => twitchApi.onThemeChanged(setTheme), []);

  return theme;
};
