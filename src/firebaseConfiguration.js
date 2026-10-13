export const REQUIRED_FIREBASE_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId']

export function firebaseConfigurationProblem(config, { production, emulators, existingOptions = null }) {
  const missing = REQUIRED_FIREBASE_FIELDS.filter((key) => typeof config[key] !== 'string' || !config[key].trim())
  if (missing.length) return `Falta la configuración de Firebase: ${missing.join(', ')}. Añade las variables VITE_FIREBASE correspondientes y reinicia la aplicación.`
  if (production && emulators) return 'Desactiva VITE_USE_FIREBASE_EMULATORS antes de desplegar en producción.'
  if (existingOptions && REQUIRED_FIREBASE_FIELDS.some((key) => existingOptions[key] !== config[key])) {
    return 'La configuración de Firebase cambió respecto a la aplicación inicializada. Recarga la página para conectar Auth y Firestore al proyecto configurado.'
  }
  return ''
}
