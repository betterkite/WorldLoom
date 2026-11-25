import './fonts.css';

// Preserve the existing family variables and fallback metrics without a
// build-time Google request. All original Unicode subsets are bundled.
export const fontVariables = 'worldloom-fonts';

// Match the former next/font latin-only preloads; other subsets load on demand.
export const fontPreloads = [
  '/fonts/geist-latin.woff2',
  '/fonts/geist-mono-latin.woff2',
  '/fonts/inter-latin.woff2',
  '/fonts/jetbrains-mono-latin.woff2',
  '/fonts/playfair-display-latin.woff2'
] as const;
