/**
 * Inline SVG icons for the control panel, drawn in currentColor so both themes tint them. The
 * preset glyphs are small silhouettes of each tree's crown; unknown presets fall back to Oak.
 */

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${body}</svg>`;

/** Trunk shared by the standing trees. */
const trunk = '<rect x="11" y="13" width="2" height="9" rx="1" fill="currentColor"/>';

export const PRESET_ICONS: Record<string, string> = {
  Oak: svg(`${trunk}<ellipse cx="12" cy="9.5" rx="7.5" ry="6" fill="currentColor" opacity="0.85"/>`),
  Maple: svg(
    `${trunk}<path d="M5 12.5a3.6 3.6 0 0 1 1.6-6.2A5.2 5.2 0 0 1 12 2.8a5.2 5.2 0 0 1 5.4 3.5A3.6 3.6 0 0 1 19 12.5a3.4 3.4 0 0 1-3 2.3H8a3.4 3.4 0 0 1-3-2.3z" fill="currentColor" opacity="0.85"/>`,
  ),
  Conifer: svg(
    `<rect x="11" y="16" width="2" height="6" rx="1" fill="currentColor"/><path d="M12 2l3.6 5.4h-2L17.5 13h-2.3L19 17.5H5L8.8 13H6.5l3.9-5.6h-2z" fill="currentColor" opacity="0.85"/>`,
  ),
  Acacia: svg(
    `<path d="M12 22v-7M12 15l-3.5-4.5M12 15l3.8-4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M2.5 9.2C2.5 6.8 6.8 5 12 5s9.5 1.8 9.5 4.2c0 .9-1.2 1.5-2.6 1.5H5.1c-1.4 0-2.6-.6-2.6-1.5z" fill="currentColor" opacity="0.85"/>`,
  ),
  Poplar: svg(`${trunk}<ellipse cx="12" cy="9" rx="3.8" ry="7.8" fill="currentColor" opacity="0.85"/>`),
  Willow: svg(
    `<rect x="11" y="9" width="2" height="13" rx="1" fill="currentColor"/><path d="M4.5 13.5a7.5 7.5 0 0 1 15 0" fill="currentColor" opacity="0.85"/><path d="M5 13v4.5M8 13v6M16 13v6M19 13v4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>`,
  ),
  Apple: svg(
    `${trunk}<circle cx="12" cy="9.5" r="6.8" fill="currentColor" opacity="0.85"/><circle cx="9" cy="10.5" r="1.3" fill="var(--eg-fruit, #c8423a)"/><circle cx="14.6" cy="8" r="1.3" fill="var(--eg-fruit, #c8423a)"/><circle cx="13.2" cy="12.4" r="1.3" fill="var(--eg-fruit, #c8423a)"/>`,
  ),
  Shrub: svg(
    `<path d="M2.5 19.5a4.2 4.2 0 0 1 3.4-5.2 5 5 0 0 1 6.1-3.6 5 5 0 0 1 6.1 3.6 4.2 4.2 0 0 1 3.4 5.2z" fill="currentColor" opacity="0.85"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`,
  ),
};

export const DICE_ICON = svg(
  '<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"/>',
);

/** GitHub mark, for the link to the project's source. */
export const GITHUB_ICON = svg(
  '<path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.8c-2.92.63-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.1-.27-.47-1.34.1-2.79 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.25 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.21 2.52.1 2.79.68.74 1.08 1.67 1.08 2.82 0 4.02-2.45 4.9-4.79 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5z"/>',
);

export const DOWNLOAD_ICON = svg(
  '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
);
