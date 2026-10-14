import { generateKeyPairSync } from 'node:crypto'
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export function emulatorCredential(projectId) {
  if (projectId !== 'demo-memorizador-solar' || process.env.NODE_ENV === 'production' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('La credencial ficticia solo es válida para el emulador demo local.')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  return cert({ projectId, clientEmail: 'emulator@example.test', privateKey })
}
export function serverFirebase() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  if (!projectId) throw Object.assign(new Error('Falta configurar el proyecto del servicio administrativo.'), { status: 503 })
  if (process.env.VITE_FIREBASE_PROJECT_ID && process.env.VITE_FIREBASE_PROJECT_ID !== projectId) throw new Error('El servicio administrativo apunta a un proyecto distinto del frontend.')
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  if (emulator && (process.env.NODE_ENV === 'production' || projectId !== 'demo-memorizador-solar' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('Configuración de emulación administrativa insegura.')
  const credential = emulator ? emulatorCredential(projectId) : process.env.FIREBASE_ADMIN_CREDENTIALS ? cert(JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS)) : applicationDefault()
  const app = getApps().find((item) => item.name === 'solar-admin') || initializeApp({ projectId, ...(credential ? { credential } : {}) }, 'solar-admin')
  return { db: getFirestore(app), auth: getAuth(app), projectId }
}
export async function authenticate(req, auth, projectId) {
  const header = req.headers?.authorization || ''
  if (!/^Bearer \S+$/.test(header)) throw Object.assign(new Error('Inicia sesión para realizar esta operación.'), { status: 401 })
  try {
    const token = await auth.verifyIdToken(header.slice(7), true)
    if (token.aud !== projectId || token.iss !== `https://securetoken.google.com/${projectId}` || !token.uid || token.uid.includes('/')) throw new Error('Identidad de otro proyecto.')
    return token.uid
  } catch { throw Object.assign(new Error('La sesión no es válida o ha sido revocada.'), { status: 401 }) }
}
