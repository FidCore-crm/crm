import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FidCore',
  description: 'Sistema de Gestión para Productores de Seguros',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head />
      <body className="min-h-screen bg-slate-100 font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
