import type { Metadata } from 'next'
import './denuncia.css'

export const metadata: Metadata = {
  title: 'Denunciar Siniestro',
  description: 'Formulario público de denuncia de siniestros',
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: '/portal-asegurado/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/portal-asegurado/icon.svg' }],
  },
}

export default function DenunciarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="denuncia-root">
      {children}
    </div>
  )
}
