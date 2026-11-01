// Turns off the soft keyboard's text assistance (capitalising, autocorrect, spellcheck)
// on xterm's helper textarea, which is where mobile keystrokes land.
export function disableTextAssist(textarea: HTMLTextAreaElement | undefined): void {
  if (!textarea) throw new Error('xterm has no helper textarea; call after open()');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('spellcheck', 'false');
}
