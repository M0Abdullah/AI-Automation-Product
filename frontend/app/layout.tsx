import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '../components/AppShell';
import { AuthProvider } from '../components/AuthProvider';
import { THEME_INIT_SCRIPT } from '../components/ThemeToggle';

/**
 * Self-hosted by next/font at build time, so there is no runtime request to
 * Google and no layout shift. Segoe UI (the Windows default) is the single
 * biggest reason an interface reads as dated.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Testing Platform',
  description: 'Requirements in, reviewed browser tests out.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required, not a shortcut: the script below
    // rewrites data-theme and adds a class to <html> BEFORE React hydrates, so
    // the server markup ("dark") and the live DOM (whatever the user chose) will
    // differ by design. Without this, React logs a hydration mismatch on every
    // load for anyone who picked light. It suppresses warnings for this element's
    // attributes only — nothing inside it.
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable}`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: the theme must be on <html> before the first
            paint, or a light-theme user sees a dark flash on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
