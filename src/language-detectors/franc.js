import { languageSamples, MIN_LETTERS, WINDOW } from './sampling.js';
import { francAll } from '../vendor/franc/index.js';
const MIN_GAP = 0.03;
export const francDetector = {
  id: 'franc', version: '6.2.0',
  detect(text) {
    // Bounded samples from the beginning, middle and end; no full-document copy.
    const votes = languageSamples(text).map(({start, text: sample}) => {
      const letters = (sample.match(/\p{L}/gu) || []).length;
      if (letters < MIN_LETTERS) return { detected: null, uncertain: true, letters, start, characters: sample.length };
      const ranked = francAll(sample, { minLength: MIN_LETTERS });
      const candidates = ranked.slice(0, 3), [best, next] = ranked;
      // Normalize the winning margin by the score range, not sample length.
      const range = best ? best[1] - ranked.at(-1)[1] : 0;
      const relativeGap = next && range > 0 ? (best[1] - next[1]) / range : next ? 0 : 1;
      return { start, characters: sample.length, detected: best?.[0] === 'und' ? null : best?.[0], uncertain: !best || best[0] === 'und' || relativeGap < MIN_GAP, letters, candidates, relativeGap };
    });
    const languages = new Set(votes.map(vote => vote.detected).filter(Boolean));
    const uncertain = votes.some(vote => vote.uncertain) || languages.size !== 1;
    return { detected: languages.size === 1 ? [...languages][0] : null, uncertain, reason: uncertain ? (languages.size > 1 ? 'Samples suggest different languages.' : votes.some(vote => vote.letters < MIN_LETTERS) ? 'Not enough text for a reliable assessment.' : 'The leading language candidates are too close.') : '', samples: votes, policy: { version: '1', minLetters: MIN_LETTERS, minRelativeGap: MIN_GAP, window: WINDOW } };
  }
};
