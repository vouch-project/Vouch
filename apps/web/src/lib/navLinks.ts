import { objectFromEntries } from './utils';

export const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/borrow', label: 'Borrow' },
  { href: '/lend', label: 'Lend' },
] as const;

export const navLinksMap = objectFromEntries(navLinks.map((link) => [link.label, link.href]));
