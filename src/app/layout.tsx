import './globals.css';
import type {ReactNode} from 'react';
import {CartProvider} from '@/lib/cart';

export const metadata = {
  title: 'Bukhara Digital Menu',
  description: 'Bukhara Restaurant digital menu and table ordering',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#602b35',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
