import Link from 'next/link'

export const metadata = {
  title: 'Acceso no disponible',
  robots: { index: false, follow: false },
}

export default function PortalClienteError() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-slate-800">Acceso no disponible</h1>
        <p className="text-sm text-slate-500 mt-2">
          Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.
        </p>
        <div className="mt-6">
          <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
