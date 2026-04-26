export const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/borrow', label: 'Borrow' },
  { href: '/lend', label: 'Lend' },
] as const;

export const navLinksMap = Object.fromEntries(navLinks.map((link) => [link.label, link.href])) as {
  [K in (typeof navLinks)[number] as K['label']]: K['href'];
};
