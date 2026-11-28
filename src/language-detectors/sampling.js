export const MIN_LETTERS = 120, WINDOW = 2048;
// Policy 1: preserve the existing UTF-16 window boundaries and letter count.
export function languageSamples(text) {
  const starts = text.length <= WINDOW ? [0] : text.length <= WINDOW * 2 ? [0, text.length - WINDOW] : [0, Math.floor((text.length - WINDOW) / 2), text.length - WINDOW];
  return starts.map(start => ({ start, text: text.slice(start, start + WINDOW) }));
}
