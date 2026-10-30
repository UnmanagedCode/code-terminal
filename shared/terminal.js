// Terminal limits the backend mirror and the browser pane must agree on.

// Scrollback lines kept by the backend mirror, and by the browser so a replay fits.
export const SCROLLBACK_LINES = 5000;
// The longest program title (OSC 0/2) kept or shown.
export const TITLE_MAX_CHARS = 256;

export const clampTitle = (title) => String(title).slice(0, TITLE_MAX_CHARS);
