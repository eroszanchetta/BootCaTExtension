import { supportedLanguages, NO_LANGUAGE } from './language-detection.js';
export function fillLanguageSelect(select, { requiredChoice = false, value = NO_LANGUAGE } = {}) {
  select.replaceChildren();
  for (const [code, name] of [...(requiredChoice ? [['', 'Choose a language option…']] : []), [NO_LANGUAGE, 'No language detection'], ...supportedLanguages.map(item => [item.code, item.name])]) {
    const option = document.createElement('option'); option.value = code; option.textContent = name; select.append(option);
  }
  select.value = value;
}
