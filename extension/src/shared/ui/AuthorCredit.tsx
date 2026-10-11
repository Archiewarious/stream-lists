import { useTranslation } from 'react-i18next';

/**
 * "By Archiewarious" at the bottom of the panel. The URL must be in the console's allowlist for links, or Twitch
 * blocks the click; the arrow says the link leaves the panel (Twitch rule 4.6.2).
 */
const AuthorCredit = () => {
  const { t } = useTranslation();

  return (
    <p className="shrink-0 text-left text-[12px] font-bold text-fg-2">
      By{' '}
      <a
        href="https://www.twitch.tv/archiewarious"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('panel.creditLink')}
        className="text-[#bf94ff] underline"
      >
        Archiewarious<span aria-hidden="true"> ↗</span>
      </a>
    </p>
  );
};

export default AuthorCredit;
