import brand from '@/generated/brand.json';
import { Link } from '@/i18n/navigation';

const RATIO = brand.logo.ratio;

/**
 * The brand lockup. Two processed versions of the same artwork are stacked and CSS shows the one
 * for the active theme (white wordmark on navy, navy wordmark on white), so there is no flash
 * and no JavaScript involved. On very narrow screens only the mascot is shown.
 */
export function Logo({ label, height = 40 }: { label: string; height?: number }) {
  const width = Math.round(height * RATIO);
  const img = (theme: 'dark' | 'light') => (
    <img
      src={`/brand/logo-${theme}-96.webp`}
      srcSet={`/brand/logo-${theme}-48.webp 1x, /brand/logo-${theme}-96.webp 2x, /brand/logo-${theme}-192.webp 4x`}
      width={width}
      height={height}
      alt=""
      decoding="async"
      fetchPriority="high"
      className={theme === 'dark' ? 'hidden dark:block' : 'hidden light:block'}
    />
  );
  return (
    <Link
      href="/"
      aria-label={label}
      prefetch
      className="flex shrink-0 items-center rounded-control"
      data-testid="logo"
    >
      <span className="hidden xs:block">
        {img('dark')}
        {img('light')}
      </span>
      <img
        src="/brand/mascot-64.webp"
        srcSet="/brand/mascot-64.webp 1x, /brand/mascot-128.webp 2x"
        width={40}
        height={40}
        alt=""
        className="xs:hidden"
      />
    </Link>
  );
}
