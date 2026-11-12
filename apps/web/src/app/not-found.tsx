import Link from 'next/link';
import { SITE_NAME } from '@/lib/config';

/**
 * Framework-level 404 (unknown top-level paths in dev). In production the exported 404.html is
 * replaced by the localized client fallback page: see scripts/postbuild.mjs.
 */
export default function NotFound() {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <title>{`Page not found – ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex" />
      </head>
      <body>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <img src="/brand/mascot-256.webp" alt="" width={140} height={140} />
          <h1 className="text-3xl font-bold">This page wandered off</h1>
          <p className="text-fg-muted">The link may be old, or the page may have moved.</p>
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-control bg-primary px-6 font-display font-semibold text-primary-fg"
          >
            Back to home
          </Link>
        </main>
      </body>
    </html>
  );
}
