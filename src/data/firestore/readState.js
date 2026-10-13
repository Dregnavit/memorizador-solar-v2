import { PRIVATE_PAGE_SIZE } from './privateQueries.js'

export const emptyReadState = () => ({ items: [], status: 'idle', loading: false, error: '', diagnostic: null, hasMore: false, last: null })
export const loadingReadState = () => ({ ...emptyReadState(), status: 'loading', loading: true })

export function failedReadState(failure, context) {
  const code = typeof failure?.code === 'string' ? failure.code.replace(/^firestore\//, '') : 'unknown'
  const originalMessage = typeof failure?.message === 'string' ? failure.message : ''
  const messages = {
    'permission-denied': 'Firestore rechazó la lectura. Comprueba que las reglas publicadas permitan a la sesión autenticada leer sus colecciones privadas.',
    unauthenticated: 'Firestore no pudo autenticar la lectura. Vuelve a iniciar sesión.',
    'failed-precondition': /index/i.test(originalMessage)
      ? 'Esta consulta necesita un índice de Firestore listo para usar. Publica los índices del repositorio y espera a que su estado sea Enabled (READY).'
      : 'Firestore rechazó una condición de la consulta. Consulta el detalle original para comprobar la configuración.',
    unavailable: 'No se pudo conectar con Firestore. Comprueba la conexión y reintenta la lectura.',
    'resource-exhausted': 'Firestore alcanzó su cuota. Comprueba el uso del proyecto antes de reintentar.',
    'invalid-argument': 'Firestore rechazó los parámetros de la consulta. Consulta el detalle original.',
  }
  return {
    ...emptyReadState(), status: 'error',
    error: messages[code] ?? 'No se pudo completar la lectura de Firestore. Consulta el código y el detalle original.',
    // Keep the SDK error intact for diagnosis; never log document contents or credentials.
    diagnostic: { code, originalMessage, ...context },
  }
}

export function snapshotReadState(snapshot, uid, schema, contract) {
  const entries = snapshot.docs.slice(0, PRIVATE_PAGE_SIZE)
  const items = []
  let invalid = false
  let pending = Boolean(snapshot.metadata.hasPendingWrites)
  for (const entry of entries) {
    const raw = entry.data()
    if (entry.metadata.hasPendingWrites) {
      pending = true
      if (!raw?.createdAt) continue
    }
    const parsed = schema.safeParse(contract(raw))
    if (parsed.success && parsed.data.id === entry.id && parsed.data.userId === uid) items.push(parsed.data)
    else invalid = true
  }
  // A cache-only snapshot cannot establish that the remote collection is empty.
  const unconfirmed = snapshot.metadata.fromCache || pending
  return {
    ...emptyReadState(), items, status: invalid ? 'invalid' : unconfirmed ? 'unconfirmed' : 'ready',
    error: invalid ? 'La lectura contiene documentos no válidos. El resultado está incompleto; no se modificó su contenido.' : '',
    hasMore: snapshot.docs.length > PRIVATE_PAGE_SIZE, last: entries.at(-1) ?? null,
  }
}

// Protect against a late snapshot/error from a listener that was already unsubscribed.
export function subscribePrivateRead(reference, { subscribe, uid, schema, contract, context, onState }) {
  let active = true
  const stop = subscribe(reference, { includeMetadataChanges: true },
    (snapshot) => { if (active) onState(snapshotReadState(snapshot, uid, schema, contract)) },
    (failure) => { if (active) onState(failedReadState(failure, context)) },
  )
  return () => { active = false; stop() }
}
