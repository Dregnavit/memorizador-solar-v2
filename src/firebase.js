import { initializeApp, getApps } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { firebaseConfigurationProblem } from './firebaseConfiguration.js'

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
const existing = getApps().find((app) => app.name === '[DEFAULT]')
const emulators = value('VITE_USE_FIREBASE_EMULATORS') === 'true'
let configurationError = firebaseConfigurationProblem(firebaseConfig, {
  production: import.meta.env.PROD, emulators, existingOptions: existing?.options,
})

if (!configurationError) {
  try {
    const app = existing ?? initializeApp(firebaseConfig)
    auth = getAuth(app)
    db = getFirestore(app)
    if (import.meta.env.DEV && emulators) {
      const marker = Symbol.for('memorizador-solar.firebase-emulators')
      if (!globalThis[marker]) {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
        connectFirestoreEmulator(db, '127.0.0.1', 8080)
        globalThis[marker] = true
      }
    }
    if (Boolean(auth.emulatorConfig) !== (import.meta.env.DEV && emulators)) {
      auth = null
      db = null
      configurationError = 'Cambió la conexión a los emuladores de Firebase. Recarga la página para aplicar el entorno configurado.'
    }
  } catch {
    auth = null
    db = null
    configurationError = 'No se pudo inicializar Firebase. Revisa la configuración web de tu proyecto.'
  }
}

export { auth, db, configurationError }
