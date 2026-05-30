import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { SystemStatusDot } from './SystemStatusDot';

export const metadata: Metadata = {
  title: 'Helmr Hatchery',
  description: 'Helmr AI Orchestration Control Room',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 md:px-6 flex-shrink-0">
              <h1 className="text-sm font-medium text-gray-300">Hatchery</h1>
              <SystemStatusDot />
            </header>
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
