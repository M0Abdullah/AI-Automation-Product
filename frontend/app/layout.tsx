import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '../components/AppShell';
import { AuthProvider } from '../components/AuthProvider';

export const metadata: Metadata = {
  title: 'AI Testing Platform',
  description: 'Requirements in, reviewed browser tests out.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
