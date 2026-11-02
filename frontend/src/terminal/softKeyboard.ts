// Turns off the soft keyboard's text assistance (capitalising, autocorrect, spellcheck)
// on the field that takes mobile keystrokes: xterm's helper textarea, or the touch-input proxy.
export function disableTextAssist(textarea: HTMLInputElement | HTMLTextAreaElement | undefined): void {
  if (!textarea) throw new Error('xterm has no helper textarea; call after open()');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('spellcheck', 'false');
}
