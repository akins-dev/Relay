import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from 'next/font/google';
import './globals.css';
import { Nav }          from '@/components/layout/Nav';
import { AuthProvider } from '@/components/AuthProvider';

// ── Fonts via next/font — zero layout shift, self-hosted at build time ────────
// This replaces the @import in globals.css which blocked rendering.
const instrumentSans = Instrument_Sans({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-editorial',
  weight: ['400', '500', '600'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

// ── Metadata ──────────────────────────────────────────────────────────────────
const SITE_URL   = 'https://openmcp.dev';
const SITE_NAME  = 'Agentrail';
const TITLE      = 'Agentrail — Runtime Tool Discovery For AI Agents';
const DESCRIPTION = 'Agentrail helps AI agents discover the tools they need at runtime and invoke them through a secure trust, policy, and credential layer.';

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
  authors:  [{ name: 'The-17', url: 'https://github.com/the-17' }],
  creator:  'The-17',
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
      alt:    'Agentrail — Runtime Tool Discovery For AI Agents',
    }],
    locale: 'en_US',
  },

  // ── Twitter / X ───────────────────────────────────────────────────────────
  twitter: {
    card:        'summary_large_image',
    title:        TITLE,
    description:  DESCRIPTION,
    images:      ['/og-image.png'],
    creator:     '@the17dev',
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
  themeColor:    '#2563eb',
  colorScheme:   'light',
  width:         'device-width',
  initialScale:  1,
};

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${newsreader.variable} ${ibmPlexMono.variable}`}>
      <body>
        <AuthProvider>
          <Nav />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
