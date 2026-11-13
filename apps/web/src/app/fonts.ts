import { Fredoka, Nunito } from 'next/font/google';

// Self-hosted at build time by next/font: no request ever goes to Google from a visitor.
export const fredoka = Fredoka({
  subsets: ['latin'],
  variable: '--font-fredoka',
  display: 'swap',
  weight: ['500', '600', '700'],
});

export const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '600', '700', '800'],
});
