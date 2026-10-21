// Site emojis from CLAUDE.md, by site code (sites.code).
// The site selector always shows them. The charts and the alt text show them only when the
// view option "Site emojis" (`params.emojis`) is on; see `siteLabel()` in `diagrams/common.ts`.
// The data export and the file names use the plain site names.

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
