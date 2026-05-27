import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Mi Portal',
  description: 'Portal personal del asegurado',
  robots: { index: false, follow: false },
  manifest: '/portal-asegurado/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mi Portal',
  },
  icons: {
    icon: [{ url: '/portal-asegurado/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/portal-asegurado/icon.svg' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0A1628',
}

export default function PortalAseguradoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif' }}
    >
      {children}
    </div>
  )
}
