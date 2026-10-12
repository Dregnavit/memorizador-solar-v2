import { collection, doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { hashValue, toTimestamp } from '@icarus/domain/codec'
import { idSchema, locusSchema, macroStationSchema, palaceSchema, uidSchema } from '@icarus/domain/schemas'
import { MigrationError } from '@icarus/domain/migration'

export const SPACE_TYPES = Object.freeze({ palace: { collection: 'palaces', schema: palaceSchema }, macro: { collection: 'macroStations', schema: macroStationSchema }, locus: { collection: 'microStations', schema: locusSchema } })

export function spaceContract(data) {
  return { ...data, createdAt: data?.createdAt?.seconds !== undefined ? { seconds: data.createdAt.seconds, nanoseconds: data.createdAt.nanoseconds } : data?.createdAt }
}

function typeFor(kind) {
  const type = SPACE_TYPES[kind]
  if (!type) throw new MigrationError('invalid-space', 'Tipo de estación no válido.')
  return type
}
function pathFor(database, userId, collectionId, id) { return doc(database, 'users', userId, collectionId, id) }
function owned(snapshot, userId) {
  if (!snapshot.exists() || snapshot.data()?.userId !== userId) throw new MigrationError('missing-parent', 'La estación superior no existe o pertenece a otra cuenta.')
  return snapshot.data()
}
function snapshotBefore(transaction, reference, data) {
  transaction.set(doc(reference, 'revisions', `v${data.version}`), data)
}

export async function createSpace(database, userId, input, intentId = crypto.randomUUID()) {
  uidSchema.parse(userId)
  idSchema.parse(intentId)
  const type = typeFor(input?.kind)
  if (input.kind !== 'palace') idSchema.parse(input.palaceId)
  if (input.kind === 'locus') idSchema.parse(input.macroId)
  const reference = pathFor(database, userId, type.collection, intentId)
  const requestHash = await hashValue(input)
  const parentForRetry = input.kind === 'macro' ? pathFor(database, userId, 'palaces', input.palaceId) : input.kind === 'locus' ? pathFor(database, userId, 'macroStations', input.macroId) : null
  // Some rule evaluations report contention as permission-denied before the SDK
  // sees the transaction precondition. Retry only a verified parent version change.
  for (let retry = 0; retry < 4; retry += 1) {
    let observedParentVersion = null
    try {
      return await runTransaction(database, async (transaction) => {
        const previous = await transaction.get(reference)
        if (previous.exists()) {
          if (previous.data().userId !== userId || previous.data().creationRequestHash !== requestHash) throw new MigrationError('intent-conflict', 'Este intento ya se utilizó con otros datos. Revisa la estación antes de repetir.')
          return { id: reference.id, reused: true }
        }
        let parentReference = null
        let parent = null
        let parentRaw = null
        if (input.kind === 'macro') {
          parentReference = pathFor(database, userId, 'palaces', input.palaceId)
          parentRaw = owned(await transaction.get(parentReference), userId)
          parent = palaceSchema.parse(spaceContract(parentRaw))
          if (parent.lifecycle !== 'active') throw new MigrationError('archived-parent', 'Restaura el palacio antes de crear una macro-estación.')
        } else if (input.kind === 'locus') {
          parentReference = pathFor(database, userId, 'macroStations', input.macroId)
          const [macroSnapshot, palaceSnapshot] = await Promise.all([transaction.get(parentReference), transaction.get(pathFor(database, userId, 'palaces', input.palaceId))])
          parentRaw = owned(macroSnapshot, userId)
          parent = macroStationSchema.parse(spaceContract(parentRaw))
          const palace = palaceSchema.parse(spaceContract(owned(palaceSnapshot, userId)))
          if (parent.palaceId !== input.palaceId || parent.lifecycle !== 'active' || palace.lifecycle !== 'active') throw new MigrationError('inconsistent-parent', 'El locus necesita una macro-estación activa del palacio seleccionado.')
        }
        const common = { id: reference.id, userId, schemaVersion: 1, version: 1, createdAt: toTimestamp(Date.now()), creationRequestHash: requestHash }
        let payload
        if (input.kind === 'palace') payload = { ...common, title: input.name, description: input.cue, lifecycle: 'active', activeMacroCount: 0, lastMutation: null }
        else if (input.kind === 'macro') payload = { ...common, palaceId: input.palaceId, name: input.name, spatialCue: input.cue, ordinal: input.ordinal, lifecycle: 'active', activeLocusCount: 0, lastMutation: null }
        else payload = { ...common, palaceId: input.palaceId, macroId: input.macroId, name: input.name, anchorDescription: input.cue, sensoryCues: input.sensoryCues, ordinal: input.ordinal, state: 'free', activeEncodingId: null, usageCountLifetime: 0 }
        const validated = type.schema.parse(payload)
        observedParentVersion = parent?.version ?? null
        // All reads precede writes; the SDK may retry this callback.
        if (parentReference) {
          snapshotBefore(transaction, parentReference, parentRaw)
          const counter = input.kind === 'macro' ? 'activeMacroCount' : 'activeLocusCount'
          transaction.update(parentReference, { [counter]: parent[counter] + 1, version: parent.version + 1, lastMutation: { action: 'create', childId: reference.id } })
        }
        transaction.set(reference, { ...validated, createdAt: serverTimestamp() })
        return { id: reference.id, reused: false }
      })
    } catch (error) {
      if (error?.code !== 'permission-denied' || !parentForRetry || observedParentVersion === null || retry === 3) throw error
      let fresh
      try { fresh = await getDocFromServer(parentForRetry) } catch { throw error }
      if (!fresh.exists() || fresh.data()?.userId !== userId || fresh.data()?.version === observedParentVersion) throw error
    }
  }
  throw new MigrationError('contention', 'No se pudo guardar tras varios cambios simultáneos. Reintenta.')
}

export async function setSpaceArchived(database, userId, { kind, id, archived, expectedVersion }) {
  uidSchema.parse(userId)
  idSchema.parse(id)
  if (typeof archived !== 'boolean') throw new MigrationError('invalid-request', 'Indica si quieres archivar o restaurar la estación.')
  const type = typeFor(kind)
  const reference = pathFor(database, userId, type.collection, id)
  return runTransaction(database, async (transaction) => {
    const ownSnapshot = await transaction.get(reference)
    const original = owned(ownSnapshot, userId)
    const current = type.schema.parse(spaceContract(original))
    if (current.version !== expectedVersion) throw new MigrationError('version-conflict', 'La estación cambió en otra sesión. Revisa su versión actual.')
    if (kind === 'locus' && (current.activeEncodingId || !['free', 'archived'].includes(current.state))) throw new MigrationError('space-in-use', 'Este lugar mantiene una codificación o una reserva activa.')
    const alreadyArchived = kind === 'locus' ? current.state === 'archived' : current.lifecycle === 'archived'
    if (alreadyArchived === archived) return { id, reused: true }
    if ((kind === 'palace' && current.activeMacroCount) || (kind === 'macro' && current.activeLocusCount)) throw new MigrationError('space-in-use', 'Esta estación conserva lugares activos. Archiva primero sus hijos.')
    let parentReference = null
    let parentSnapshot = null
    let parent = null
    if (kind !== 'palace') {
      parentReference = pathFor(database, userId, kind === 'macro' ? 'palaces' : 'macroStations', kind === 'macro' ? current.palaceId : current.macroId)
      parentSnapshot = await transaction.get(parentReference)
      parent = (kind === 'macro' ? palaceSchema : macroStationSchema).parse(spaceContract(owned(parentSnapshot, userId)))
      if (parent.lifecycle !== 'active') throw new MigrationError('archived-parent', 'La estación superior debe estar activa.')
    }
    snapshotBefore(transaction, reference, original)
    transaction.update(reference, { [kind === 'locus' ? 'state' : 'lifecycle']: archived ? 'archived' : kind === 'locus' ? 'free' : 'active', version: current.version + 1 })
    if (parentReference) {
      snapshotBefore(transaction, parentReference, parentSnapshot.data())
      const counter = kind === 'macro' ? 'activeMacroCount' : 'activeLocusCount'
      transaction.update(parentReference, { [counter]: parent[counter] + (archived ? -1 : 1), version: parent.version + 1, lastMutation: { action: archived ? 'archive' : 'restore', childId: id } })
    }
    return { id, reused: false }
  })
}

export function newSpaceIntent(database, userId, kind) {
  return doc(collection(database, 'users', userId, typeFor(kind).collection)).id
}
