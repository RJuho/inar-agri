// Site emojis from CLAUDE.md, by site code (sites.code).
// Use them in the site selector only. Chart legends and alt text use the plain site names.

export const SITE_EMOJI: Readonly<Record<string, string>> = {
  anttila: '👱🏻‍♂️🫛',
  sarkisuo: '🐟🌱',
  haltiala: '🧚🌾',
  qvidja: '🐂🐝',
  viikki: '👩🏻‍🔬🎓',
  maktau: '🇰🇪🌽',
};

/** Emoji of a site code, or an empty string for an unknown code. */
export function siteEmoji(code: string): string {
  return SITE_EMOJI[code] ?? '';
}
