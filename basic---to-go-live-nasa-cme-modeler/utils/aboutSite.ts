// The marketing site: what the app is, how it works, the FAQ and the change
// log, written for people rather than for the app's own panels. The app links
// to it wherever someone might want to know more.

export const ABOUT_SITE = 'https://about.spottheaurora.co.nz';

export const aboutLink = (page: '' | 'features' | 'how-it-works' | 'data' | 'faq' | 'about' | 'changelog' = '') =>
  `${ABOUT_SITE}/${page}`;
