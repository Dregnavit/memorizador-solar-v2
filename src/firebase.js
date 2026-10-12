import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const value = (name) => {
  const input = import.meta.env[name]
  return typeof input === 'string' ? input.trim() : ''
}

const firebaseConfig = {
  apiKey: value('VITE_FIREBASE_API_KEY'),
  authDomain: value('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: value('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: value('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: value('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: value('VITE_FIREBASE_APP_ID'),
  measurementId: value('VITE_FIREBASE_MEASUREMENT_ID'),
}

let auth = null
let db = null
let configurationError = ''

const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter(
  (key) => !firebaseConfig[key],
)

if (missing.length) {
  configurationError = `Falta la configuración de Firebase: ${missing.join(', ')}. Añade las variables VITE_FIREBASE correspondientes y reinicia la aplicación.`
} else if (import.meta.env.PROD && value('VITE_USE_FIREBASE_EMULATORS') === 'true') {
  configurationError = 'Desactiva VITE_USE_FIREBASE_EMULATORS antes de desplegar en producción.'
} else {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
    auth = getAuth(app)
    db = getFirestore(app)
    if (import.meta.env.DEV && value('VITE_USE_FIREBASE_EMULATORS') === 'true') {
      const marker = Symbol.for('memorizador-solar.firebase-emulators')
      if (!globalThis[marker]) {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
        connectFirestoreEmulator(db, '127.0.0.1', 8080)
        globalThis[marker] = true
      }
    }
  } catch {
    auth = null
    db = null
    configurationError = 'No se pudo inicializar Firebase. Revisa la configuración web de tu proyecto.'
  }
}

export { auth, db, configurationError }
