import { EVOLUTION_ENABLED } from '../../evolution.js'
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { privateRef } from './cognitiveRepository.js'

export async function requireActiveSource(tx, db, uid, sourceId) {
  const [source, maintenance] = await Promise.all([tx.get(privateRef(db, uid, 'sources', sourceId)), EVOLUTION_ENABLED ? tx.get(doc(db, 'users', uid, 'control', 'maintenance')) : Promise.resolve({ exists: () => false })])
  if (maintenance.exists() && maintenance.data().blocked) throw new Error('Hay una eliminación en curso. Reanúdala antes de modificar el archivo.')
  if (!source.exists() || source.data().userId !== uid || source.data().lifecycle !== 'active') throw new Error('Este manuscrito está archivado o no está disponible. No se modificó su progreso.')
  return source.data()
}

export async function setSourceArchived(db, uid, sourceId, archived, requestId) {
  const ref = privateRef(db, uid, 'sources', sourceId)
  const receipt = privateRef(db, uid, 'sourceOperations', requestId)
  return runTransaction(db, async (tx) => {
    const [snapshot, maintenance, previous] = await Promise.all([tx.get(ref), EVOLUTION_ENABLED ? tx.get(doc(db, 'users', uid, 'control', 'maintenance')) : Promise.resolve({ exists: () => false }), tx.get(receipt)])
    if (previous.exists()) {
      if (previous.data().sourceId !== sourceId || previous.data().target !== (archived ? 'archived' : 'active')) throw new Error('La operación pertenece a otra transición.')
      return
    }
    if (maintenance.exists() && maintenance.data().blocked) throw new Error('Hay una eliminación en curso.')
    if (!snapshot.exists() || snapshot.data().userId !== uid) throw new Error('No se encontró el manuscrito de esta cuenta.')
    const source = snapshot.data(); const lifecycle = archived ? 'archived' : 'active'
    tx.set(receipt, { id: requestId, userId: uid, sourceId, target: lifecycle, changed: source.lifecycle !== lifecycle, outcomeVersion: source.version + (source.lifecycle === lifecycle ? 0 : 1), createdAt: serverTimestamp() })
    if (source.lifecycle === lifecycle) return
    const event = privateRef(db, uid, 'sourceEvents', `${sourceId}_v${source.version + 1}`)
    tx.update(ref, { lifecycle, version: source.version + 1 })
    tx.set(event, { id: event.id, requestId, userId: uid, sourceId, from: source.lifecycle, to: lifecycle, previousVersion: source.version, newVersion: source.version + 1, createdAt: serverTimestamp() })
  })
}
