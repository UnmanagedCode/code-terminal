// Turns off the soft keyboard's text assistance (capitalising, autocorrect, spellcheck)
// on the field that takes mobile keystrokes: xterm's helper textarea, or the touch-input proxy.
export function disableTextAssist(textarea: HTMLInputElement | HTMLTextAreaElement | undefined): void {
  if (!textarea) throw new Error('xterm has no helper textarea; call after open()');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('spellcheck', 'false');
}

// What keeps autofill services and password managers (Bitwarden, 1Password, LastPass, Chrome's own)
// from reading the touch input as a login. The input is created as a password field to hide the
// keyboard's suggestion strip, so none of these may change its type or inputmode.
export const AUTOFILL_OPT_OUT: Readonly<Record<string, string>> = {
  name: 'terminal-input',
  'aria-autocomplete': 'none',
  'data-bwignore': 'true',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
};

export function optOutOfAutofill(el: HTMLInputElement): void {
  for (const [name, value] of Object.entries(AUTOFILL_OPT_OUT)) el.setAttribute(name, value);
}
