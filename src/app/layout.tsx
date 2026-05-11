import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav }           from '@/components/layout/Nav';
import { AuthProvider }  from '@/components/AuthProvider';
import { LenisProvider } from '@/components/LenisProvider';
import { SITE_URL }      from '@/lib/site';
import { BRAND }         from '@/lib/brand';

// ── Fonts via next/font — zero layout shift, self-hosted at build time ────────
const spaceGrotesk = Space_Grotesk({
  subsets:  ['latin'],
  variable: '--font-inter', // mapped to original css variable for ease
  display:  'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-editorial', // mapped to original display variable
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono', // mapped to original mono variable
  weight: ['400', '500', '600'],
  display: 'swap',
});

// ── Metadata ──────────────────────────────────────────────────────────────────
const SITE_NAME   = BRAND.name;
const TITLE       = `${BRAND.name} — The Intelligence Layer for Agent Tools`;
const DESCRIPTION = BRAND.description;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  // ── Core ──────────────────────────────────────────────────────────────────
  title: {
    default:  TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: [
    'MCP', 'Model Context Protocol', 'AI agents', 'tool discovery',
    'MCP registry', 'MCP security', 'open source', 'agent infrastructure',
  ],
  authors:  [{ name: BRAND.org, url: BRAND.githubUrl }],
  creator:  BRAND.org,
  publisher: SITE_NAME,

  // ── Canonical ─────────────────────────────────────────────────────────────
  alternates: { canonical: SITE_URL },

  // ── OpenGraph ─────────────────────────────────────────────────────────────
  openGraph: {
    type:        'website',
    url:          SITE_URL,
    siteName:     SITE_NAME,
    title:        TITLE,
    description:  DESCRIPTION,
    images: [{
      url:    '/og-image.png',
      width:  1200,
      height: 630,
      alt:    `${BRAND.name} — The Intelligence Layer for Agent Tools`,
    }],
    locale: 'en_US',
  },

  // ── Twitter / X ───────────────────────────────────────────────────────────
  twitter: {
    card:        'summary_large_image',
    title:        TITLE,
    description:  DESCRIPTION,
    images:      ['/og-image.png'],
    creator:     BRAND.twitterHandle,
  },

  // ── Robots ────────────────────────────────────────────────────────────────
  robots: {
    index:             true,
    follow:            true,
    googleBot: {
      index:             true,
      follow:            true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet':       -1,
    },
  },

  // ── Manifest / icons ──────────────────────────────────────────────────────
  icons: {
    icon:       '/favicon.ico',
    shortcut:   '/favicon-16x16.png',
    apple:      '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor:    '#050505',
  colorScheme:   'dark',
  width:         'device-width',
  initialScale:  1,
};

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${outfit.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-black text-white antialiased">
        <LenisProvider>
          <AuthProvider>
            <Nav />
            <main>{children}</main>
          </AuthProvider>
        </LenisProvider>
      </body>
    </html>
  );
}
