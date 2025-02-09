import { findBestAvailableLanguage } from 'react-native-localize';

export const ALL_LANGUAGES = [
  'es',
  'ru',
  'en',
  'de',
  'fr',
  'it',
  'ko',
  'uk',
  'pl',
  'zh',
];

export function getSystemLanguage() {
  const systemLang = findBestAvailableLanguage(ALL_LANGUAGES);
  if (systemLang) {
    return systemLang.languageTag;
  }
  return 'en';
}

export function localizedName(lang: string) {
  switch (lang) {
    case 'en': return 'English';
    case 'es': return 'Español';
    case 'de': return 'Deutsch';
    case 'it': return 'Italiano';
    case 'fr': return 'Français';
    case 'ko': return '한국어';
    case 'uk': return 'Українська';
    case 'pl': return 'Polski';
    case 'ru': return 'Pусский';
    case 'zh': return '汉语';
    default: return 'Unknown';
  }
}
