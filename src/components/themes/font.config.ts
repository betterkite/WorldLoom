import { Geist, Geist_Mono, Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';

import { cn } from '@/lib/utils';

const fontSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans'
});

const fontMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono'
});

const fontInter = Inter({
  subsets: ['latin'],
  variable: '--font-inter'
});

const fontJetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono'
});

const fontPlayfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair-display'
});

export const fontVariables = cn(
  fontSans.variable,
  fontMono.variable,
  fontInter.variable,
  fontJetBrainsMono.variable,
  fontPlayfairDisplay.variable
);
