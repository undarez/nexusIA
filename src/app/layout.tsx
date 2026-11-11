import './globals.css';
import './modules.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'NEXUS V4.2', description: 'NEXUS Desktop prototype' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="fr"><body>{children}</body></html>; }
