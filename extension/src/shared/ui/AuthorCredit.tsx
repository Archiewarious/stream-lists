/** "By Archiewarious" at the bottom of the panel. The URL must be in the console's allowlist for links, or Twitch blocks the click. */
const AuthorCredit = () => (
  <p className="shrink-0 text-center text-[12px] font-bold text-fg-2">
    By{' '}
    <a href="https://www.twitch.tv/archiewarious" target="_blank" rel="noopener noreferrer" className="text-[#bf94ff] underline">
      Archiewarious
    </a>
  </p>
);

export default AuthorCredit;
