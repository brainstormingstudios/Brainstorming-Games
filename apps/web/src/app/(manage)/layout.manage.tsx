import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { MANAGE_URL, SITE_NAME } from '@/lib/config';
import '../globals.css';

/** Root layout of the management website (its own build and its own domain). */
export const metadata: Metadata = {
  metadataBase: new URL(MANAGE_URL),
  title: { default: `Management – ${SITE_NAME}`, template: `%s – Management – ${SITE_NAME}` },
  applicationName: `${SITE_NAME} Management`,
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: '48x48' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <PortalShell kind="manage">{children}</PortalShell>;
}
