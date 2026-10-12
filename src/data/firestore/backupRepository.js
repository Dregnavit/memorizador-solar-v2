import { Bytes, collection, doc, DocumentReference, documentId, GeoPoint, getDocsFromServer, limit, orderBy, query, startAfter, Timestamp, where } from 'firebase/firestore'
import { createLegacyBackup, MigrationError } from '@icarus/domain/migration'
import { encodeValue, PortableFirestoreValue } from '@icarus/domain/codec'

export function firestoreValueAdapter(database) {
  return {
    identify(value) {
      if (value instanceof Timestamp) return { type: 'timestamp', value: { seconds: value.seconds, nanoseconds: value.nanoseconds } }
      if (value instanceof GeoPoint) return { type: 'geopoint', value: { latitude: value.latitude, longitude: value.longitude } }
      if (value instanceof Bytes) return { type: 'bytes', value: value.toBase64() }
      if (value instanceof DocumentReference) {
        if (value.firestore !== database) throw new MigrationError('foreign-database-reference', 'Una referencia pertenece a otra base; requiere un respaldo administrativo.')
        return { type: 'reference', value: { projectId: database.app.options.projectId, databaseId: '(default)', path: value.path } }
      }
      return undefined
    },
    restore(wire) {
      if (wire.type === 'timestamp') return new Timestamp(wire.value.seconds, wire.value.nanoseconds)
      if (wire.type === 'geopoint') return new GeoPoint(wire.value.latitude, wire.value.longitude)
      if (wire.type === 'bytes') return Bytes.fromBase64String(wire.value)
      if (wire.type === 'reference' && wire.value.projectId === database?.app?.options?.projectId && wire.value.databaseId === '(default)') return doc(database, wire.value.path)
      return new PortableFirestoreValue(wire)
    },
  }
}

export async function captureOwnLegacyBackup(database, userId, { maxTexts = 500, maxProgressPerText = 2000, maxBytes = 50 * 1024 * 1024, signal, onProgress } = {}) {
  if (!database || typeof userId !== 'string' || !userId.trim()) throw new MigrationError('no-session', 'Necesitas una sesión válida para exportar tus textos.')
  const adapter = firestoreValueAdapter(database)
  const records = []
  let lastText = null
  let estimatedBytes = 0
  let progressCount = 0
  function checkAbort() {
    if (signal?.aborted) throw new MigrationError('cancelled', 'Captura cancelada. No se modificó ningún dato.')
  }
  while (true) {
    checkAbort()
    const constraints = [where('userId', '==', userId), orderBy(documentId()), limit(25)]
    if (lastText) constraints.push(startAfter(lastText))
    const snapshot = await getDocsFromServer(query(collection(database, 'texts'), ...constraints))
    if (snapshot.metadata.hasPendingWrites) throw new MigrationError('pending-writes', 'Hay cambios pendientes de confirmar. Espera antes de capturar.')
    if (!snapshot.docs.length) break
    for (const source of snapshot.docs) {
      checkAbort()
      if (records.length >= maxTexts) throw new MigrationError('capture-limit', 'La biblioteca supera el límite de la captura en navegador. Usa un respaldo administrativo; no se descargó un archivo incompleto.')
      const data = source.data()
      if (data.userId !== userId) throw new MigrationError('ownership', 'La captura encontró un texto de otra cuenta.')
      const progress = []
      let lastProgress = null
      while (true) {
        checkAbort()
        const progressConstraints = [orderBy(documentId()), limit(100)]
        if (lastProgress) progressConstraints.push(startAfter(lastProgress))
        const page = await getDocsFromServer(query(collection(database, 'texts', source.id, 'progress'), ...progressConstraints))
        if (page.metadata.hasPendingWrites) throw new MigrationError('pending-writes', 'Hay progreso pendiente de confirmar.')
        for (const entry of page.docs) {
          if (progress.length >= maxProgressPerText) throw new MigrationError('capture-limit', 'Un texto supera el límite de progreso de la captura en navegador. No se descargó un archivo incompleto.')
          const progressData = entry.data()
          estimatedBytes += JSON.stringify(encodeValue(progressData, adapter)).length * 2
          progress.push({ chunkId: entry.id, data: progressData })
          progressCount += 1
        }
        if (page.docs.length < 100) break
        lastProgress = page.docs.at(-1)
      }
      estimatedBytes += JSON.stringify(encodeValue(data, adapter)).length * 2
      if (estimatedBytes > maxBytes) throw new MigrationError('capture-limit', 'El respaldo supera el tamaño admitido por el navegador. Usa un respaldo administrativo; no se truncaron datos.')
      records.push({ textId: source.id, data, progress })
      onProgress?.({ textCount: records.length, progressCount })
    }
    if (snapshot.docs.length < 25) break
    lastText = snapshot.docs.at(-1)
  }
  checkAbort()
  return createLegacyBackup({ userId, records, consistency: 'uncoordinated' }, adapter)
}
