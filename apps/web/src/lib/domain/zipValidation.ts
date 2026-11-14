/**
 * Validation of an uploaded game build (a .zip unpacked in the browser with JSZip).
 *
 * Rules: at most 250 MB and 1,500 files; an index.html at the root (a single wrapping folder is
 * stripped); relative paths only; no path traversal, symlinks, executables or file types a web
 * game cannot use.
 */
export const BUILD_LIMITS = { maxBytes: 250 * 1024 * 1024, maxFiles: 1500 } as const;

/** File types a web build may contain (mirrors the play origin's allow-list). */
export const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'xml', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif',
  'ico', 'woff', 'woff2', 'ttf', 'otf', 'wasm', 'data', 'bin', 'unityweb', 'pck', 'mem', 'br', 'gz', 'mp3',
  'ogg', 'wav', 'm4a', 'mp4', 'webm', 'atlas', 'fnt', 'glb', 'gltf', 'ktx2', 'basis', 'map',
]);

const EXECUTABLE = new Set(['exe', 'dll', 'bat', 'cmd', 'com', 'sh', 'ps1', 'msi', 'apk', 'app', 'dmg', 'jar', 'scr', 'vbs', 'so', 'dylib', 'php', 'py', 'pl', 'cgi']);
/** OS junk that is skipped silently rather than rejected. */
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\.git\/)/i;

export interface ZipEntryInfo {
  path: string;
  size: number;
  dir: boolean;
  /** Unix mode from the zip, when present (used to spot symlinks). */
  unixPermissions?: number | null;
}

export interface ValidatedFile {
  /** Path inside the build, without the wrapping folder. */
  path: string;
  /** Path inside the zip. */
  source: string;
  size: number;
}

export interface BuildValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  files: ValidatedFile[];
  totalBytes: number;
  /** The SDK script tag or package name was found in the build. */
  mentionsSdk: boolean;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Checks the zip's entry list. `sampleText` returns text of small files to look for the SDK. */
export function validateBuild(entries: readonly ZipEntryInfo[]): BuildValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files = entries.filter((e) => !e.dir && !JUNK.test(e.path));

  for (const e of files) {
    const p = e.path.replace(/\\/g, '/');
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) errors.push(`Absolute path is not allowed: ${p}`);
    if (p.split('/').some((seg) => seg === '..')) errors.push(`Path traversal is not allowed: ${p}`);
    if (p.includes('\0')) errors.push(`Invalid file name: ${p}`);
    if (e.unixPermissions != null && (e.unixPermissions & S_IFMT) === S_IFLNK) errors.push(`Symbolic links are not allowed: ${p}`);
    const ext = extensionOf(p);
    if (EXECUTABLE.has(ext)) errors.push(`Executable files are not allowed: ${p}`);
    else if (!ALLOWED_EXTENSIONS.has(ext)) errors.push(`File type .${ext || '(none)'} is not allowed: ${p}`);
  }

  // Strip one wrapping folder ("MyGame/index.html") when everything sits inside it.
  const paths = files.map((f) => f.path.replace(/\\/g, '/'));
  let prefix = '';
  if (!paths.includes('index.html')) {
    const tops = new Set(paths.map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/') + 1) : '')));
    const only = tops.size === 1 ? [...tops][0]! : '';
    if (only && paths.includes(`${only}index.html`)) prefix = only;
  }
  const normalised: ValidatedFile[] = files.map((f) => {
    const p = f.path.replace(/\\/g, '/');
    return { path: prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p, source: f.path, size: f.size };
  });
  if (!normalised.some((f) => f.path === 'index.html')) errors.push('index.html must be at the root of the zip.');

  const totalBytes = normalised.reduce((n, f) => n + f.size, 0);
  if (normalised.length === 0) errors.push('The zip is empty.');
  if (normalised.length > BUILD_LIMITS.maxFiles) errors.push(`Too many files: ${normalised.length} (limit ${BUILD_LIMITS.maxFiles}).`);
  if (totalBytes > BUILD_LIMITS.maxBytes) errors.push(`The build is ${Math.round(totalBytes / 1048576)} MB (limit 250 MB).`);
  if (totalBytes > 50 * 1024 * 1024) warnings.push('Large builds load slowly on mobile data. Under 50 MB is a good target.');
  const big = normalised.filter((f) => f.size > 25 * 1024 * 1024);
  if (big.length) warnings.push(`Files over 25 MB may not work with every host: ${big.map((f) => f.path).join(', ')}`);

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, files: normalised, totalBytes, mentionsSdk: false };
}

/** Whether HTML or JS source references the SDK (checked on index.html and small scripts). */
export function mentionsSdk(source: string): boolean {
  return /bg-sdk\.js|@brainstorming\/sdk|\bBG\.init\s*\(/.test(source);
}

/** Absolute URLs inside index.html (`src="/x.js"`) break on the play origin's sub-folder. */
export function findAbsolutePaths(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi)) out.add(m[1]!);
  return [...out];
}
