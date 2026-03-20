import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/layout/Nav';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'openMCP — Secure MCP Registry',
  description: 'Open-source security layer for the MCP ecosystem. Discover, verify, and invoke MCP servers with 12-layer protection.'  //'The open-source universal registry for MCP servers. Discover, publish, and securely invoke any MCP tool at runtime.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
