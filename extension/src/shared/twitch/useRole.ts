import { useEffect, useState } from 'react';

import { twitchApi } from '@shared/twitch/twitchApi';

type Role = 'broadcaster' | 'moderator' | 'viewer' | 'external';

/** The role claim of the Twitch JWT. Only for choosing what to show — the Worker checks the token itself. */
const readRole = (token: string): Role | null => {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role ?? null;
  } catch {
    return null;
  }
};

/** null until Twitch has authorized the extension. */
export const useRole = () => {
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => twitchApi.onAuthorized(({ token }) => setRole(readRole(token))), []);

  return role;
};
