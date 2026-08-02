const UNSPLASH = 'https://images.unsplash.com';

function envImage(key, fallback) {
  return process.env[`REACT_APP_CDN_${key}`] || fallback;
}

const loginHeroes = [
  envImage('LOGIN_HERO_1', `${UNSPLASH}/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1920&q=82`),
  envImage('LOGIN_HERO_2', `${UNSPLASH}/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1920&q=82`),
  envImage('LOGIN_HERO_3', `${UNSPLASH}/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1920&q=82`),
  envImage('LOGIN_HERO_4', `${UNSPLASH}/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1920&q=82`),
];

const customerHeroes = [
  envImage('CUSTOMER_1', `${UNSPLASH}/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1800&q=80`),
  envImage('CUSTOMER_2', `${UNSPLASH}/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1800&q=80`),
  envImage('CUSTOMER_3', `${UNSPLASH}/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1800&q=80`),
];

const supplierHeroes = [
  envImage('SUPPLIER_1', `${UNSPLASH}/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=1800&q=80`),
  envImage('SUPPLIER_2', `${UNSPLASH}/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1800&q=80`),
  envImage('SUPPLIER_3', `${UNSPLASH}/photo-1494412519320-aa613dfb7738?auto=format&fit=crop&w=1800&q=80`),
];

const adminHeroes = [
  envImage('ADMIN_1', `${UNSPLASH}/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1800&q=80`),
  envImage('ADMIN_2', `${UNSPLASH}/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1800&q=80`),
  envImage('ADMIN_3', `${UNSPLASH}/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1800&q=80`),
];

const systemHeroes = [
  envImage('SYSTEM_1', `${UNSPLASH}/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1800&q=80`),
  envImage('SYSTEM_2', `${UNSPLASH}/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1800&q=80`),
  envImage('SYSTEM_3', `${UNSPLASH}/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1800&q=80`),
];

export const remoteImages = {
  loginHero: envImage('LOGIN_HERO', loginHeroes[0]),
  loginHeroes,
  splash: [
    envImage('SPLASH_1', `${UNSPLASH}/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1920&q=80`),
    envImage('SPLASH_2', `${UNSPLASH}/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1920&q=80`),
    envImage('SPLASH_3', `${UNSPLASH}/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80`),
    envImage('SPLASH_4', `${UNSPLASH}/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1920&q=80`),
    envImage('SPLASH_5', `${UNSPLASH}/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=1920&q=80`),
  ],
  admin: envImage('ADMIN', adminHeroes[0]),
  adminHeroes,
  invoices: envImage('INVOICES', `${UNSPLASH}/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=1600&q=75`),
  ledger: envImage('LEDGER', `${UNSPLASH}/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1600&q=75`),
  customer: envImage('CUSTOMER', customerHeroes[0]),
  customerHeroes,
  supplier: envImage('SUPPLIER', supplierHeroes[0]),
  supplierHeroes,
  system: envImage('SYSTEM', systemHeroes[0]),
  systemHeroes,
  registration: envImage('REGISTRATION', `${UNSPLASH}/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1600&q=75`),
  verification: envImage('VERIFICATION', `${UNSPLASH}/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=75`),
};
