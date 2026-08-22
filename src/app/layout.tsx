import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TravelGieni — Find where to go',
  description: 'Destination discovery for Europe, built around your travel preferences.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
