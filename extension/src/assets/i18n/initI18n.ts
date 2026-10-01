import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@assets/i18n/locales/en.json';
import ru from '@assets/i18n/locales/ru.json';

/** Twitch passes the viewer's language as ?language=ru; outside Twitch the browser language is used. */
const detectLanguage = () => {
  const language = new URLSearchParams(window.location.search).get('language') ?? navigator.language;
  return language.startsWith('ru') ? 'ru' : 'en';
};

export const initI18n = () =>
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ru: { translation: ru } },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
