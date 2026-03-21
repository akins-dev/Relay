import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Nav }          from '@/components/layout/Nav';
import { AuthProvider } from '@/components/AuthProvider';

// ── Fonts via next/font — zero layout shift, self-hosted at build time ────────
// This replaces the @import in globals.css which blocked rendering.
const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
});

// Lora and JetBrains Mono loaded on demand via CSS — acceptable for headings/code.
// next/font/google handles caching and self-hosting.

// ── Metadata ──────────────────────────────────────────────────────────────────
const SITE_URL   = 'https://openmcp.dev';
const SITE_NAME  = 'openMCP';
const TITLE      = 'openMCP — The Secure MCP Registry';
const DESCRIPTION = 'Free, open-source registry for MCP servers. 7,000+ servers scanned across 15 security layers. One line connects any AI agent to every tool it needs.';

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
      alt:    'openMCP — The Secure MCP Registry',
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
  themeColor:    '#c2440c',
  colorScheme:   'light',
  width:         'device-width',
  initialScale:  1,
};

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>
          <Nav />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
