export const GOOGLE_LINK_MESSAGE = 'BootCaT can’t read Google’s result links. Try signing in to Google and running the search again, or switch to a different search engine.';
export function challengeMessage(engine) {
  const name = ({ google: 'Google', duckduckgo: 'DuckDuckGo', ecosia: 'Ecosia' })[engine] || 'The search engine';
  return `${name} is asking you to verify that you’re human. Open this tab and complete the check, or switch to a different search engine.`;
}
export function collectionLinkWarning(result) {
  if (!result?.unresolved) return '';
  if (result.engine === 'google' && result.unreadableGoogle) return 'Some Google result links could not be read. Try signing in to Google and running the search again, or switch to a different search engine.';
  return 'Some links could not be added. Open the search tab to review them.';
}
export function collectionFailure(result) {
  if (result.challenge) return challengeMessage(result.engine);
  if (result.engine === 'google' && result.unreadableGoogle && result.unreadableGoogle === result.unresolved) return GOOGLE_LINK_MESSAGE;
  return 'No search results could be collected. Open the tab to check the page, or switch to a different search engine.';
}
