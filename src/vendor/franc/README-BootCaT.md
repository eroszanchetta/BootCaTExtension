# Bundled franc detector

franc 6.2.0, trigram-utils 2.0.0, n-gram 2.0.2 and collapse-white-space 2.1.0 are MIT-licensed upstream sources. Each original licence is included. `sources.json` records pinned source URLs and the SHA-256 of every bundled source/notice. Retrieved 2026-11-12.

Only package import paths were changed to local sibling ES modules. Language model data, regular expressions and detection algorithms are unchanged. `README-franc.md` is the upstream language table; `../../language-names.js` derives names from it, deduplicating languages supported in multiple scripts. This snapshot contains 178 distinct language codes.

All source, data and notices ship inside both extension packages; there is no runtime npm/CDN/network dependency. Language detection loads the model lazily when enabled. Source updates must be reviewed, pins/hashes/notices updated, and detector, language-list, persistence and real-browser tests rerun. npm audit does not track these vendored files.

BootCaT's sample policy, uncertainty heuristic and project workflow live outside these upstream files, in language-detectors/franc.js and language-detection.js. Detector scores are diagnostic distances, not probabilities or calibrated confidence percentages.
