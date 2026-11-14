import { SITE_NAME } from '@/lib/config';
import './globals.css';

/** 404 page of the developer portal website. */
export default function NotFound() {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <title>{`Page not found – Developer Portal – ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex" />
      </head>
      <body>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <img src="/brand/mascot-256.webp" alt="" width={120} height={120} />
          <h1 className="text-3xl font-bold">This page does not exist</h1>
          <p className="text-fg-muted">The link may be old, or the page may have moved.</p>
          <a href="/" className="inline-flex h-12 items-center rounded-control bg-primary px-6 font-display font-semibold text-primary-fg">
            Back to the developer portal
          </a>
        </main>
      </body>
    </html>
  );
}
