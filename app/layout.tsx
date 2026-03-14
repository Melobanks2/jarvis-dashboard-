import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/AppContext';

export const metadata: Metadata = {
  title: 'Jarvis Command Center',
  description: 'AI-powered wholesale operations dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
