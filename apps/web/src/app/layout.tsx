import type { ReactNode } from 'react';
import './globals.css';

/**
 * The real <html> lives in the locale layouts ((en)/layout.tsx and [locale]/layout.tsx) so each
 * language gets its own `lang`. This root only exists because Next requires one.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
