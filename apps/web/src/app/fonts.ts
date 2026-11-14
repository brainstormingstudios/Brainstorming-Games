import localFont from 'next/font/local';

// The font files live in this repo (src/fonts, copied from the @fontsource-variable packages,
// SIL Open Font License). Nothing is fetched at build time, and no request ever goes to a font
// service from a visitor.

/** Headings and buttons: Bricolage Grotesque, a grotesque with some character, set tight. */
export const displayFont = localFont({
  src: '../fonts/bricolage-grotesque-latin-wght-normal.woff2',
  variable: '--font-display-face',
  display: 'swap',
  weight: '200 800',
});

/** Body text: Figtree. */
export const bodyFont = localFont({
  src: '../fonts/figtree-latin-wght-normal.woff2',
  variable: '--font-body-face',
  display: 'swap',
  weight: '300 900',
});

/** Class names that define both font variables; goes on <html>. */
export const fontClasses = [displayFont.variable, bodyFont.variable].join(' ');
