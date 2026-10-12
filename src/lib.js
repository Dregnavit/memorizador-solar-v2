export { DAY_MS, normalizeProgress, calculateReview, isDue } from '@icarus/domain/legacy'
export const MAX_TEXT_LENGTH = 60000
export const MAX_CHUNKS = 1000
export const safeString = (value) => typeof value === 'string' ? value : ''

export function splitText(rawText, type) {
  const input = safeString(rawText).trim()
  if (!input) return []
  const separator = type === 'poesia' ? /\n+/ : /(?<=[.!?])\s+|\n+/
  return input.split(separator).map((text) => text.trim()).filter(Boolean)
    .map((text, order) => ({ id: `chunk_${order}`, text, order }))
}

export function normalizeChunks(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.filter((chunk) => {
    const id = safeString(chunk?.id).trim()
    if (!id || id.includes('/') || id.length > 128 || seen.has(id) || !safeString(chunk?.text).trim()) return false
    seen.add(id)
    return true
  }).map((chunk, index) => ({
    id: chunk.id.trim(),
    text: chunk.text.trim(),
    order: Number.isFinite(chunk.order) ? chunk.order : index,
  })).sort((a, b) => a.order - b.order)
}

export function previewText(value, length = 120) {
  const chars = Array.from(safeString(value).trim())
  return chars.slice(0, length).join('') + (chars.length > length ? '…' : '')
}

export function formatReview(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Sin repasar todavía'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

export function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/invalid-login-credentials': 'El correo o la contraseña no son correctos.',
    'auth/wrong-password': 'El correo o la contraseña no son correctos.',
    'auth/user-not-found': 'El correo o la contraseña no son correctos.',
    'auth/email-already-in-use': 'Ya existe una cuenta con este correo. Inicia sesión.',
    'auth/invalid-email': 'Introduce un correo electrónico válido.',
    'auth/missing-password': 'Introduce tu contraseña.',
    'auth/weak-password': 'La contraseña no cumple la política de seguridad de Firebase.',
    'auth/password-does-not-meet-requirements': 'La contraseña no cumple la política de seguridad de Firebase.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta con el administrador.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a intentar.',
    'auth/network-request-failed': 'No se pudo conectar. Revisa tu conexión a internet.',
    'auth/operation-not-allowed': 'Activa el proveedor Email/Password en Firebase Authentication.',
    'auth/invalid-api-key': 'La configuración de Firebase contiene una API key no válida.',
    'auth/unauthorized-domain': 'Autoriza este dominio en Firebase Authentication.',
    'permission-denied': 'No tienes permiso para esta operación. Revisa las reglas de Firestore y tu sesión.',
    'unauthenticated': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    'unavailable': 'Firestore no está disponible. Revisa tu conexión y vuelve a intentar.',
    'resource-exhausted': 'Se alcanzó el límite de Firebase. Inténtalo más tarde.',
    'failed-precondition': 'Firestore necesita configuración adicional. Revisa la base de datos y sus índices.',
    'not-found': 'El texto ya no está disponible.',
  }
  return messages[safeString(error?.code)] || 'No se pudo completar la operación. Vuelve a intentar.'
}
