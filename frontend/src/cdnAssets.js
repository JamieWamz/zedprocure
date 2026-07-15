const UNSPLASH = 'https://images.unsplash.com';

function envImage(key, fallback) {
  return process.env[`REACT_APP_CDN_${key}`] || fallback;
}

export const cdnImages = {
  loginHero: envImage('LOGIN_HERO', `${UNSPLASH}/photo-1497366754035-f200968a6e3b?auto=format&fit=crop&w=1600&q=75`),
  splash: [
    envImage('SPLASH_1', `${UNSPLASH}/photo-1497366754035-f200968a6e3b?auto=format&fit=crop&w=1920&q=75`),
    envImage('SPLASH_2', `${UNSPLASH}/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=75`),
    envImage('SPLASH_3', `${UNSPLASH}/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1920&q=75`),
    envImage('SPLASH_4', `${UNSPLASH}/photo-1497215842964-222b430dc094?auto=format&fit=crop&w=1920&q=75`),
    envImage('SPLASH_5', `${UNSPLASH}/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=1920&q=75`),
  ],
  admin: envImage('ADMIN', `${UNSPLASH}/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=75`),
  invoices: envImage('INVOICES', `${UNSPLASH}/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=1600&q=75`),
  ledger: envImage('LEDGER', `${UNSPLASH}/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1600&q=75`),
  customer: envImage('CUSTOMER', `${UNSPLASH}/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1600&q=75`),
  supplier: envImage('SUPPLIER', `${UNSPLASH}/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=75`),
  system: envImage('SYSTEM', `${UNSPLASH}/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1600&q=75`),
};
