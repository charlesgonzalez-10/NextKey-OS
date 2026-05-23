import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NextKey OS',
  description: 'NextKey Property Solutions — Back Office Operating System',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  )
}
