import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { DEVELOPERS_URL, SITE_NAME } from '@/lib/config';
import '../globals.css';

/** Root layout of the developer portal website (its own build and its own domain). */
export const metadata: Metadata = {
  metadataBase: new URL(DEVELOPERS_URL),
  title: { default: `Developer Portal – ${SITE_NAME}`, template: `%s – Developer Portal – ${SITE_NAME}` },
  applicationName: `${SITE_NAME} Developer Portal`,
  robots: undefined,
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: '48x48' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <PortalShell kind="developers">{children}</PortalShell>;
}
