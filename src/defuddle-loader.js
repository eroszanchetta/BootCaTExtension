// The local browser bundle is loaded before app.js (no runtime CDN requests).
export function defuddleConstructor() {
  const value = globalThis.Defuddle;
  return typeof value === 'function' ? value : value?.default || value?.Defuddle;
}
export const DEFUDDLE_AVAILABLE = typeof defuddleConstructor() === 'function';
export const DEFUDDLE_VERSION = '0.19.0';
