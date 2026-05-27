'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Loader2, Pencil, MoreVertical,
  KeyRound, Unlock, UserX, UserCheck, Trash2, X, UserCog,
  AlertTriangle, ShieldCheck, ShieldX, Hourglass, Mail
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { ConfirmacionTipeada } from '@/components/ConfirmacionTipeada'

interface UsuarioRow {
  id: string
  nombre: string
  apellido: string
  email: string
  rol: 'ADMIN' | 'USUARIO'
  acceso_cartera: 'TOTAL' | 'PROPIA'
  activo: boolean
  ultimo_acceso: string | null
  intentos_fallidos: number
  bloqueado_hasta: string | null
  created_at: string
  clientes_asignados: number
}

interface SolicitudBlanqueoRow {
  id: string
  usuario_id: string
  estado: 'PENDIENTE' | 'HABILITADA'
  ip_origen: string | null
  user_agent: string | null
  created_at: string
  fecha_habilitacion: string | null
  habilitada_por_admin_id: string | null
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailEsValido(email: string): boolean {
  return REGEX_EMAIL.test(email.trim())
}

function tiempoRelativo(fechaStr: string | null): string {
  if (!fechaStr) return 'Nunca'
  const ahora = Date.now()
  const fecha = new Date(fechaStr).getTime()
  const diff = ahora - fecha
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `Hace ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias < 30) return `Hace ${dias}d`
  return `Hace ${Math.floor(dias / 30)} mes(es)`
}

function estaBloqueado(u: UsuarioRow): boolean {
  return !!u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()
}

export default function UsuariosPage() {
  const router = useRouter()
  const { usuario: adminActual, isAdmin } = useAuth()

  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([])
  const [solicitudes, setSolicitudes] = useState<SolicitudBlanqueoRow[]>([])
  const [cargando, setCargando] = useState(true)
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null)

  // Modales
  const [modalCrear, setModalCrear] = useState(false)
  const [modalEditar, setModalEditar] = useState<UsuarioRow | null>(null)
  const [modalPassword, setModalPassword] = useState<UsuarioRow | null>(null)
  const [modalRechazar, setModalRechazar] = useState<{ usuario: UsuarioRow; solicitud: SolicitudBlanqueoRow } | null>(null)
  const [modalEliminar, setModalEliminar] = useState<UsuarioRow | null>(null)
  const [toastMsg, setToastMsg] = useState('')

  // Contar admins
  const totalAdmins = usuarios.filter(u => u.rol === 'ADMIN').length

  useEffect(() => {
    if (!isAdmin && adminActual) {
      router.replace('/crm/dashboard')
    }
  }, [isAdmin, adminActual, router])

  const cargar = async () => {
    const [r1, r2] = await Promise.all([
      apiCall<{ usuarios: UsuarioRow[] }>('/api/usuarios', undefined, { mostrar_toast_en_error: false }),
      apiCall<{ solicitudes: SolicitudBlanqueoRow[] }>('/api/usuarios/solicitudes-blanqueo', undefined, { mostrar_toast_en_error: false }),
    ])
    if (r1.ok && r1.data) setUsuarios(r1.data.usuarios)
    if (r2.ok && r2.data) setSolicitudes(r2.data.solicitudes)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  // Map { usuario_id → solicitud } para acceso rápido en cada fila.
  const solicitudPorUsuario = new Map<string, SolicitudBlanqueoRow>()
  for (const s of solicitudes) solicitudPorUsuario.set(s.usuario_id, s)

  const totalSolicitudesPendientes = solicitudes.filter(s => s.estado === 'PENDIENTE').length
  const totalSolicitudesHabilitadas = solicitudes.filter(s => s.estado === 'HABILITADA').length

  const habilitarBlanqueo = async (u: UsuarioRow, sol: SolicitudBlanqueoRow) => {
    if (!confirm(`¿Habilitar el blanqueo de contraseña para ${u.nombre} ${u.apellido}? Va a poder definir una nueva contraseña en su próximo intento de login.`)) return
    const r = await apiCall(`/api/usuarios/solicitudes-blanqueo/${sol.id}/habilitar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Blanqueo habilitado. El usuario puede definir su contraseña.')
      mostrarToast('Blanqueo habilitado')
      cargar()
    } else {
      const msg = r.error?.mensaje ?? 'No se pudo habilitar'
      toast.error(msg)
      mostrarToast(msg)
    }
    setMenuAbierto(null)
  }

  const mostrarToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  const toggleActivo = async (u: UsuarioRow) => {
    const r = await apiCall(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      body: { activo: !u.activo },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      const msg = u.activo ? 'Usuario desactivado' : 'Usuario activado'
      toast.exito(msg)
      mostrarToast(msg)
      cargar()
    } else {
      const msg = r.error?.mensaje ?? 'Error'
      toast.error(msg)
      mostrarToast(msg)
    }
    setMenuAbierto(null)
  }

  const reenviarInvitacion = async (u: UsuarioRow) => {
    const r = await apiCall(`/api/usuarios/${u.id}/reenviar-invitacion`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito(`Invitación reenviada a ${u.email}`)
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo reenviar la invitación')
    }
    setMenuAbierto(null)
  }

  const desbloquear = async (u: UsuarioRow) => {
    const r = await apiCall(`/api/usuarios/${u.id}/desbloquear`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Usuario desbloqueado')
      mostrarToast('Usuario desbloqueado')
      cargar()
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo desbloquear')
    }
    setMenuAbierto(null)
  }

  const eliminar = (u: UsuarioRow) => {
    setMenuAbierto(null)
    setModalEliminar(u)
  }

  const confirmarEliminar = async () => {
    if (!modalEliminar) return
    const u = modalEliminar
    const r = await apiCall(`/api/usuarios/${u.id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Usuario eliminado')
      mostrarToast('Usuario eliminado')
      cargar()
      setModalEliminar(null)
    } else {
      const msg = r.error?.mensaje ?? 'Error'
      toast.error(msg)
      mostrarToast(msg)
    }
  }

  if (!isAdmin) return null

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando usuarios...
    </div>
  )

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white text-xs px-4 py-2 rounded shadow-lg animate-fade-in">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/crm/configuracion')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Gestión de usuarios</h1>
            <p className="text-xs text-slate-500">Creá y administrá los usuarios del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/crm/configuracion/usuarios/asignar')} className="btn-secondary flex items-center gap-1">
            <UserCog className="h-3 w-3" /> Asignar clientes
          </button>
          <button onClick={() => setModalCrear(true)} className="btn-primary flex items-center gap-1">
            <Plus className="h-3 w-3" /> Invitar usuario
          </button>
        </div>
      </div>

      {/* Banner solicitudes pendientes */}
      {totalSolicitudesPendientes > 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-amber-900">
              {totalSolicitudesPendientes === 1
                ? '1 solicitud de blanqueo de contraseña pendiente'
                : `${totalSolicitudesPendientes} solicitudes de blanqueo de contraseña pendientes`}
            </p>
            <p className="text-2xs text-amber-700 mt-0.5">
              Habilitá o rechazá cada una desde el menú de acciones de la fila correspondiente.
            </p>
          </div>
        </div>
      )}
      {totalSolicitudesHabilitadas > 0 && totalSolicitudesPendientes === 0 && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded">
          <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-xs text-emerald-800">
            {totalSolicitudesHabilitadas === 1
              ? '1 usuario con blanqueo habilitado'
              : `${totalSolicitudesHabilitadas} usuarios con blanqueo habilitado`}, esperando que defina su nueva contraseña.
          </p>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table w-full">
          <thead>
            <tr>
              <th className="text-left">Usuario</th>
              <th className="text-left">Rol</th>
              <th className="text-left">Acceso</th>
              <th className="text-left">Estado</th>
              <th className="text-left">Último acceso</th>
              <th className="text-left">Clientes</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => {
              const bloqueado = estaBloqueado(u)
              const esSelf = u.id === adminActual?.id
              const esUltimoAdmin = u.rol === 'ADMIN' && totalAdmins <= 1
              const solicitud = solicitudPorUsuario.get(u.id)

              return (
                <tr key={u.id} className={solicitud?.estado === 'PENDIENTE' ? 'bg-amber-50/40' : solicitud?.estado === 'HABILITADA' ? 'bg-emerald-50/40' : undefined}>
                  <td>
                    <div className="text-xs font-medium text-slate-700">{u.apellido}, {u.nombre}</div>
                    <div className="text-2xs text-slate-400">{u.email}</div>
                    {solicitud?.estado === 'PENDIENTE' && (
                      <div className="mt-1 inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-300">
                        <Hourglass className="h-2.5 w-2.5" /> Blanqueo solicitado
                      </div>
                    )}
                    {solicitud?.estado === 'HABILITADA' && (
                      <div className="mt-1 inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">
                        <ShieldCheck className="h-2.5 w-2.5" /> Blanqueo habilitado
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border ${
                      u.rol === 'ADMIN'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      {u.rol}
                    </span>
                  </td>
                  <td>
                    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border ${
                      u.acceso_cartera === 'TOTAL'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {u.acceso_cartera === 'TOTAL' ? 'Toda la cartera' : 'Solo su cartera'}
                    </span>
                  </td>
                  <td>
                    {bloqueado ? (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                        Bloqueado
                      </span>
                    ) : u.activo ? (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                        Activo
                      </span>
                    ) : u.ultimo_acceso ? (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                        Inactivo
                      </span>
                    ) : (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                        Invitación pendiente
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="text-2xs text-slate-500">{tiempoRelativo(u.ultimo_acceso)}</span>
                  </td>
                  <td>
                    {u.acceso_cartera === 'PROPIA' ? (
                      <span className="text-xs font-mono text-slate-600">{u.clientes_asignados}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModalEditar(u)}
                        className="btn-tabla-accion">
                        <Pencil />
                      </button>
                      <div className="relative">
                        <button onClick={() => setMenuAbierto(menuAbierto === u.id ? null : u.id)}
                          className="btn-tabla-accion-neutral">
                          <MoreVertical />
                        </button>
                        {menuAbierto === u.id && (
                          <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded shadow-lg z-50 py-1">
                            {!u.activo && !u.ultimo_acceso && (
                              <>
                                <button onClick={() => reenviarInvitacion(u)}
                                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 font-medium">
                                  <Mail className="h-3 w-3" /> Reenviar invitación
                                </button>
                                <div className="border-t border-slate-100 my-1" />
                              </>
                            )}
                            {solicitud?.estado === 'PENDIENTE' && (
                              <>
                                <button onClick={() => habilitarBlanqueo(u, solicitud)}
                                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 font-medium">
                                  <ShieldCheck className="h-3 w-3" /> Habilitar blanqueo
                                </button>
                                <button onClick={() => { setModalRechazar({ usuario: u, solicitud }); setMenuAbierto(null) }}
                                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">
                                  <ShieldX className="h-3 w-3" /> Rechazar blanqueo
                                </button>
                                <div className="border-t border-slate-100 my-1" />
                              </>
                            )}
                            <button onClick={() => { setModalPassword(u); setMenuAbierto(null) }}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                              <KeyRound className="h-3 w-3" /> Cambiar contraseña
                            </button>
                            {bloqueado && (
                              <button onClick={() => desbloquear(u)}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                                <Unlock className="h-3 w-3" /> Desbloquear
                              </button>
                            )}
                            {!esSelf && (
                              <button onClick={() => toggleActivo(u)}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                                {u.activo ? <><UserX className="h-3 w-3" /> Desactivar</> : <><UserCheck className="h-3 w-3" /> Activar</>}
                              </button>
                            )}
                            {!esSelf && !esUltimoAdmin && (
                              <>
                                <div className="border-t border-slate-100 my-1" />
                                <button onClick={() => eliminar(u)}
                                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                                  <Trash2 className="h-3 w-3" /> Eliminar
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Click fuera cierra menú */}
      {menuAbierto && <div className="fixed inset-0 z-40" onClick={() => setMenuAbierto(null)} />}

      {/* Modal Crear */}
      {modalCrear && (
        <ModalCrearUsuario
          onClose={() => setModalCrear(false)}
          onCreated={() => { setModalCrear(false); cargar(); mostrarToast('Invitación enviada por email') }}
        />
      )}

      {/* Modal Editar */}
      {modalEditar && (
        <ModalEditarUsuario
          usuario={modalEditar}
          totalAdmins={totalAdmins}
          onClose={() => setModalEditar(null)}
          onSaved={() => { setModalEditar(null); cargar(); mostrarToast('Usuario actualizado') }}
        />
      )}

      {/* Modal Password */}
      {modalPassword && (
        <ModalResetPassword
          usuario={modalPassword}
          onClose={() => setModalPassword(null)}
          onSaved={() => { setModalPassword(null); mostrarToast('Contraseña actualizada') }}
        />
      )}

      {/* Modal Rechazar blanqueo */}
      {modalRechazar && (
        <ModalRechazarBlanqueo
          usuario={modalRechazar.usuario}
          solicitud={modalRechazar.solicitud}
          onClose={() => setModalRechazar(null)}
          onRechazado={() => { setModalRechazar(null); cargar(); mostrarToast('Solicitud rechazada') }}
        />
      )}

      <ConfirmacionTipeada
        abierto={!!modalEliminar}
        titulo="Eliminar usuario"
        mensaje={
          modalEliminar
            ? `Vas a eliminar a ${modalEliminar.nombre} ${modalEliminar.apellido} (${modalEliminar.email}). Esta acción es irreversible y elimina su cuenta del sistema.`
            : ''
        }
        palabraConfirmar="ELIMINAR"
        etiquetaConfirmar="Eliminar usuario"
        onConfirmar={confirmarEliminar}
        onCancelar={() => setModalEliminar(null)}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════
// MODAL RECHAZAR BLANQUEO
// ══════════════════════════════════════════════════
function ModalRechazarBlanqueo({ usuario, solicitud, onClose, onRechazado }: {
  usuario: UsuarioRow; solicitud: SolicitudBlanqueoRow; onClose: () => void; onRechazado: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const r = await apiCall(`/api/usuarios/solicitudes-blanqueo/${solicitud.id}/rechazar`, {
      method: 'POST',
      body: { motivo: motivo.trim() || undefined },
    }, { mostrar_toast_en_error: false })
    setEnviando(false)
    if (r.ok) {
      toast.exito('Solicitud rechazada')
      onRechazado()
    } else {
      setError(r.error?.mensaje ?? 'No se pudo rechazar')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">
            Rechazar blanqueo — {usuario.nombre} {usuario.apellido}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            Si rechazás la solicitud, el usuario va a poder volver a iniciar sesión con su contraseña actual. Si querés que cambie la contraseña, mejor habilitá el blanqueo en lugar de rechazarlo.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Motivo (opcional)
            </label>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ej: el usuario me dijo que se acordó de la contraseña..."
              className="form-input w-full"
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={enviando} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={enviando} className="btn-danger">
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Rechazar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MODAL CREAR USUARIO
// ══════════════════════════════════════════════════
function ModalCrearUsuario({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<'ADMIN' | 'USUARIO'>('USUARIO')
  const [acceso, setAcceso] = useState<'TOTAL' | 'PROPIA'>('PROPIA')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!emailEsValido(email)) { setError('Ingresá un email válido (ej: nombre@dominio.com)'); return }

    setGuardando(true)
    const r = await apiCall<{ usuario: any; warning?: string }>('/api/usuarios', {
      method: 'POST',
      body: { nombre, apellido, email, rol, acceso_cartera: rol === 'ADMIN' ? 'TOTAL' : acceso },
    }, { mostrar_toast_en_error: false })
    setGuardando(false)

    if (r.ok) {
      onCreated()
    } else {
      setError(r.error?.mensaje ?? 'Error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Invitar usuario</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
            El usuario va a recibir un email con un link para activar su cuenta y definir su propia contraseña.
            La cuenta queda inactiva hasta que acepte la invitación.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre <span className="text-red-500">*</span></label>
              <input required value={nombre} onChange={e => setNombre(e.target.value)} className="form-input w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Apellido <span className="text-red-500">*</span></label>
              <input required value={apellido} onChange={e => setApellido(e.target.value)} className="form-input w-full" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email <span className="text-red-500">*</span></label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@dominio.com" className="form-input w-full" />
            <p className="text-2xs text-slate-400 mt-1">
              Tiene que ser un correo real al que el usuario tenga acceso — ahí va a llegar el link de activación.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rol <span className="text-red-500">*</span></label>
            <select value={rol} onChange={e => setRol(e.target.value as any)} className="form-input w-full">
              <option value="USUARIO">Usuario</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
          {rol === 'USUARIO' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Acceso a cartera</label>
              <select value={acceso} onChange={e => setAcceso(e.target.value as any)} className="form-input w-full">
                <option value="PROPIA">Solo su cartera</option>
                <option value="TOTAL">Toda la cartera</option>
              </select>
              <p className="text-2xs text-slate-400 mt-1">
                {acceso === 'PROPIA' ? 'Solo ve los clientes que él crea o que le asignes' : 'Puede ver y gestionar todos los clientes del sistema'}
              </p>
            </div>
          )}
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary">
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enviar invitación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MODAL EDITAR USUARIO
// ══════════════════════════════════════════════════
function ModalEditarUsuario({ usuario, totalAdmins, onClose, onSaved }: {
  usuario: UsuarioRow; totalAdmins: number; onClose: () => void; onSaved: () => void
}) {
  const [nombre, setNombre] = useState(usuario.nombre)
  const [apellido, setApellido] = useState(usuario.apellido)
  const [email, setEmail] = useState(usuario.email)
  const [rol, setRol] = useState(usuario.rol)
  const [acceso, setAcceso] = useState(usuario.acceso_cartera)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const esUltimoAdmin = usuario.rol === 'ADMIN' && totalAdmins <= 1

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!emailEsValido(email)) { setError('Ingresá un email válido (ej: nombre@dominio.com)'); return }

    setGuardando(true)
    const r = await apiCall(`/api/usuarios/${usuario.id}`, {
      method: 'PATCH',
      body: { nombre, apellido, email, rol, acceso_cartera: rol === 'ADMIN' ? 'TOTAL' : acceso },
    }, { mostrar_toast_en_error: false })
    setGuardando(false)

    if (r.ok) onSaved()
    else setError(r.error?.mensaje ?? 'Error')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Editar usuario — {usuario.nombre} {usuario.apellido}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre <span className="text-red-500">*</span></label>
              <input required value={nombre} onChange={e => setNombre(e.target.value)} className="form-input w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Apellido <span className="text-red-500">*</span></label>
              <input required value={apellido} onChange={e => setApellido(e.target.value)} className="form-input w-full" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email <span className="text-red-500">*</span></label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rol</label>
            {esUltimoAdmin ? (
              <>
                <select disabled value="ADMIN" className="form-input w-full opacity-50">
                  <option value="ADMIN">Administrador</option>
                </select>
                <p className="text-2xs text-amber-600 mt-1">No se puede cambiar el rol porque es el único administrador</p>
              </>
            ) : (
              <select value={rol} onChange={e => setRol(e.target.value as any)} className="form-input w-full">
                <option value="USUARIO">Usuario</option>
                <option value="ADMIN">Administrador</option>
              </select>
            )}
          </div>
          {rol === 'USUARIO' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Acceso a cartera</label>
              <select value={acceso} onChange={e => setAcceso(e.target.value as any)} className="form-input w-full">
                <option value="PROPIA">Solo su cartera</option>
                <option value="TOTAL">Toda la cartera</option>
              </select>
            </div>
          )}
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary">
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MODAL RESETEAR CONTRASEÑA
// ══════════════════════════════════════════════════
function ModalResetPassword({ usuario, onClose, onSaved }: {
  usuario: UsuarioRow; onClose: () => void; onSaved: () => void
}) {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
    if (password !== password2) { setError('Las contraseñas no coinciden'); return }

    setGuardando(true)
    const r = await apiCall(`/api/usuarios/${usuario.id}/password`, {
      method: 'PATCH',
      body: { password },
    }, { mostrar_toast_en_error: false })
    setGuardando(false)

    if (r.ok) onSaved()
    else setError(r.error?.mensaje ?? 'Error')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Cambiar contraseña — {usuario.nombre} {usuario.apellido}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nueva contraseña <span className="text-red-500">*</span></label>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="form-input w-full" placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Repetir contraseña <span className="text-red-500">*</span></label>
            <input type="password" required value={password2} onChange={e => setPassword2(e.target.value)} className="form-input w-full" />
          </div>
          <p className="text-2xs text-slate-400">La nueva contraseña se aplica inmediatamente. Las sesiones activas del usuario se mantendrán.</p>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary flex items-center gap-1.5">
              {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
              Cambiar contraseña
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
