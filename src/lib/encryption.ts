import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = process.env.ENCRYPTION_KEY

export function isEncryptionAvailable(): boolean {
  return !!KEY && KEY.length === 64
}

export function encrypt(text: string): string {
  if (!KEY) throw new Error('ENCRYPTION_KEY no configurada')
  if (KEY.length !== 64) throw new Error('ENCRYPTION_KEY debe ser de 64 caracteres hex')

  const keyBuffer = Buffer.from(KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv)

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ])

  const authTag = cipher.getAuthTag()

  // Formato: iv:authTag:encrypted (todo en hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encryptedText: string): string {
  if (!KEY) throw new Error('ENCRYPTION_KEY no configurada')

  const parts = encryptedText.split(':')
  if (parts.length !== 3) throw new Error('Formato de texto encriptado inválido')

  const [ivHex, authTagHex, encryptedHex] = parts
  const keyBuffer = Buffer.from(KEY, 'hex')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}
