import { EVOLUTION_ENABLED } from '../../evolution.js'
import { requireActiveSource } from './sourceLifecycleRepository.js'
import { collection, doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { canonicalJson, hashValue, toTimestamp } from '@icarus/domain/codec'
import { sourceSchema, sourceRevisionSchema, unitSchema, cardSchema, conceptSchema, encodingSchema, locusSchema, uidSchema, idSchema, reviewEventSchema, validateUnitAgainstRevision } from '@icarus/domain/schemas'
import { buildEncodingBundle, workshopPayloadSchema } from '@icarus/domain/encoding'
import { maximumRating, recallSucceeded, stageCompletion, validateRating } from '@icarus/domain/review'
import { scheduleReview, unpackScheduler } from '@icarus/domain/scheduler'
import { MigrationError } from '@icarus/domain/migration'

export const privateRef = (db, uid, kind, id) => doc(db, 'users', uidSchema.parse(uid), kind, idSchema.parse(id))
export const newPrivateId = (db, uid, kind) => doc(collection(db, 'users', uidSchema.parse(uid), kind)).id
export const firestoreTime = (time) => new Timestamp(time.seconds, time.nanoseconds)
export function recordContract(data) {
  const parsed = { ...data }
  for (const key of ['createdAt', 'updatedAt', 'dueAt', 'lastReviewedAt', 'reviewedAt', 'dueBefore', 'dueAfter']) {
    if (data?.[key]?.seconds !== undefined) parsed[key] = { seconds: data[key].seconds, nanoseconds: data[key].nanoseconds }
  }
  return parsed
}
function own(snapshot, uid) {
  if (!snapshot.exists() || snapshot.data()?.userId !== uid) throw new MigrationError('missing-record', 'No se encontró el documento de esta cuenta.')
  return snapshot.data()
}
function materialize(data) { return { ...data, createdAt: serverTimestamp() } }

export async function createSource(db, uid, input, intentId) {
  const requestHash = await hashValue(input)
  const contentHash = await hashValue(input.originalText)
  const ref = privateRef(db, uid, 'sources', intentId)
  const now = toTimestamp(Date.now())
  const source = sourceSchema.parse({ id: intentId, userId: uid, schemaVersion: 1, version: 1, createdAt: now, title: input.title?.trim(), kind: input.kind, lifecycle: 'active', currentRevisionId: 'r1', provenance: { type: 'user' }, creationRequestHash: requestHash })
  const revision = sourceRevisionSchema.parse({ id: 'r1', userId: uid, schemaVersion: input.learningGoal ? 2 : 1, version: 1, createdAt: now, sourceId: intentId, revisionNumber: 1, originalText: input.originalText, contentHash, hashAlgorithm: 'sha256-canonical-json-v1', ...(input.learningGoal ? { edition: input.edition || '', learningGoal: input.learningGoal } : {}), language: input.language?.trim() || 'und', segmentationMode: input.segmentationMode, provenance: { type: 'user' } })
  return runTransaction(db, async (tx) => {
    const previous = await tx.get(ref)
    const maintenance = EVOLUTION_ENABLED ? await tx.get(doc(db, 'users', uid, 'control', 'maintenance')) : null
    if (maintenance?.exists() && maintenance.data().blocked) throw new Error('Hay una eliminación en curso.')
    if (previous.exists()) {
      if (own(previous, uid).creationRequestHash !== requestHash) throw new MigrationError('intent-conflict', 'El intento corresponde a otro manuscrito.')
      return intentId
    }
    tx.set(ref, materialize(source))
    tx.set(doc(ref, 'revisions', 'r1'), materialize(revision))
    return intentId
  })
}

export async function createUnit(db, uid, sourceId, selection) {
  const sourceRef = privateRef(db, uid, 'sources', sourceId)
  const unitId = `u_${(await hashValue({ uid, sourceId, revisionId: selection.revisionId, start: selection.startOffset, end: selection.endOffset })).slice(7)}`
  const ref = privateRef(db, uid, 'units', unitId)
  return runTransaction(db, async (tx) => {
    const [sourceSnapshot, revisionSnapshot, existing] = await Promise.all([tx.get(sourceRef), tx.get(doc(sourceRef, 'revisions', idSchema.parse(selection.revisionId))), tx.get(ref)])
    await requireActiveSource(tx, db, uid, sourceId)
    const source = sourceSchema.parse(recordContract(own(sourceSnapshot, uid)))
    const revision = sourceRevisionSchema.parse(recordContract(own(revisionSnapshot, uid)))
    if (source.lifecycle !== 'active' || source.currentRevisionId !== revision.id) throw new MigrationError('stale-source', 'Selecciona la revisión activa de la fuente.')
    const data = unitSchema.parse({ id: unitId, userId: uid, schemaVersion: 1, version: 1, createdAt: toTimestamp(Date.now()), sourceId, sourceRevisionId: revision.id, unitRevision: 1, ordinal: selection.ordinal, text: revision.originalText.slice(selection.startOffset, selection.endOffset), status: 'needs_concept', startOffset: selection.startOffset, endOffset: selection.endOffset, traceStatus: 'resolved', targetMode: null, targets: [], primaryConceptId: null, activeEncodingId: null, legacyRef: null })
    validateUnitAgainstRevision(data, revision)
    if (existing.exists()) { unitSchema.parse(recordContract(own(existing, uid))); return unitId }
    tx.set(ref, materialize(data))
    tx.set(doc(ref, 'revisions', 'v1'), materialize(data))
    return unitId
  })
}

export async function readUnitContext(db, uid, unitId) {
  const unit = unitSchema.parse(recordContract(own(await getDocFromServer(privateRef(db, uid, 'units', unitId)), uid)))
  const sourceRef = privateRef(db, uid, 'sources', unit.sourceId)
  const [sourceSnapshot, revisionSnapshot, draftSnapshot] = await Promise.all([getDocFromServer(sourceRef), getDocFromServer(doc(sourceRef, 'revisions', unit.sourceRevisionId)), getDocFromServer(privateRef(db, uid, 'encodingDrafts', unitId))])
  const source = sourceSchema.parse(recordContract(own(sourceSnapshot, uid)))
  const revision = sourceRevisionSchema.parse(recordContract(own(revisionSnapshot, uid)))
  validateUnitAgainstRevision(unit, revision)
  const draft = draftSnapshot.exists() ? own(draftSnapshot, uid) : null
  if (draft) workshopPayloadSchema.parse(draft.payload)
  const membership = EVOLUTION_ENABLED ? await getDocFromServer(privateRef(db, uid, 'literalMemberships', unitId)) : null
  return { unit, source, revision, draft, literalManaged: membership?.exists() }
}

export async function saveWorkshopDraft(db, uid, unitId, payload, step, expectedVersion) {
  const data = workshopPayloadSchema.parse(payload)
  if (!Number.isInteger(step) || step < 0 || step > 7) throw new Error('Paso de Taller no válido.')
  const ref = privateRef(db, uid, 'encodingDrafts', unitId)
  return runTransaction(db, async (tx) => {
    const [previous, unitSnapshot] = await Promise.all([tx.get(ref), tx.get(privateRef(db, uid, 'units', unitId))])
    const unit = own(unitSnapshot, uid)
    await requireActiveSource(tx, db, uid, unit.sourceId)
    if (unit.status === 'ready' || unit.status === 'archived') throw new MigrationError('published-unit', 'Esta unidad ya está publicada o archivada.')
    if (previous.exists() && own(previous, uid).version === expectedVersion + 1 && previous.data().status === 'draft' && previous.data().step === step && canonicalJson(previous.data().payload) === canonicalJson(data)) return expectedVersion + 1
    if ((previous.exists() ? own(previous, uid).version : 0) !== expectedVersion) throw new MigrationError('version-conflict', 'El Taller cambió en otra pestaña. Recarga para recuperar el borrador guardado.')
    if (previous.exists() && previous.data().status !== 'draft') throw new MigrationError('published-draft', 'El borrador ya se publicó.')
    const version = expectedVersion + 1
    tx.set(ref, { id: unitId, userId: uid, schemaVersion: 1, version, unitId, sourceRevisionId: unit.sourceRevisionId, status: 'draft', payload: data, step, publishedEncodingId: null, createdAt: previous.exists() ? previous.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() })
    return version
  })
}

export async function publishEncoding(db, uid, unitId, expectedDraftVersion) {
  const encodingId = `${unitId}_e1`
  const encodingRef = privateRef(db, uid, 'encodings', encodingId)
  const unitRef = privateRef(db, uid, 'units', unitId)
  const draftRef = privateRef(db, uid, 'encodingDrafts', unitId)
  return runTransaction(db, async (tx) => {
    const [previous, unitSnapshot, draftSnapshot] = await Promise.all([tx.get(encodingRef), tx.get(unitRef), tx.get(draftRef)])
    const draft = own(draftSnapshot, uid)
    const requestHash = await hashValue({ unitId, payload: draft.payload })
    if (previous.exists()) {
      if (own(previous, uid).requestHash !== requestHash) throw new MigrationError('intent-conflict', 'Ya hay otra codificación publicada para esta unidad.')
      return encodingId
    }
    if (draft.version !== expectedDraftVersion || draft.status !== 'draft') throw new MigrationError('version-conflict', 'El borrador cambió; revisa su última versión antes de publicar.')
    const unitRaw = own(unitSnapshot, uid)
    const unit = unitSchema.parse(recordContract(unitRaw))
    await requireActiveSource(tx, db, uid, unit.sourceId)
    if (unit.status === 'ready' || unit.status === 'archived' || unit.activeEncodingId) throw new MigrationError('unit-in-use', 'Esta unidad ya tiene una codificación activa o está archivada.')
    const p = workshopPayloadSchema.parse(draft.payload)
    const membership = EVOLUTION_ENABLED ? await tx.get(privateRef(db, uid, 'literalMemberships', unitId)) : null
    if (membership?.exists() && p.mode !== 'conceptual') throw new Error('La literalidad de esta unidad tiene su propio recorrido. Elige Comprender y explicar en el Taller para evitar duplicar objetivos verbales.')
    const locusRef = privateRef(db, uid, 'microStations', p.locusId)
    const [revisionSnapshot, locusSnapshot, macroSnapshot, palaceSnapshot, historySnapshot] = await Promise.all([
      tx.get(doc(privateRef(db, uid, 'sources', unit.sourceId), 'revisions', unit.sourceRevisionId)), tx.get(locusRef), tx.get(privateRef(db, uid, 'macroStations', p.macroId)), tx.get(privateRef(db, uid, 'palaces', p.palaceId)), tx.get(doc(unitRef, 'revisions', `v${unit.version}`)),
    ])
    const revision = sourceRevisionSchema.parse(recordContract(own(revisionSnapshot, uid)))
    const locusRaw = own(locusSnapshot, uid)
    const locus = locusSchema.parse(recordContract(locusRaw))
    const macro = own(macroSnapshot, uid); const palace = own(palaceSnapshot, uid)
    if (locus.state !== 'free' || locus.activeEncodingId || locus.macroId !== p.macroId || locus.palaceId !== p.palaceId || macro.palaceId !== p.palaceId || macro.lifecycle !== 'active' || palace.lifecycle !== 'active') throw new MigrationError('locus-in-use', 'El locus dejó de estar libre o su ruta no está activa. Elige otro lugar.')
    if (!p.foundational) {
      const linked = conceptSchema.parse(recordContract(own(await tx.get(privateRef(db, uid, 'concepts', p.linkedConceptId)), uid)))
      if (linked.status !== 'reviewed') throw new MigrationError('unreviewed-link', 'Enlaza un concepto revisado.')
    }
    const bundle = buildEncodingBundle({ userId: uid, unit, revision, payload: p, encodingId, draftId: unitId, requestHash })
    if (!historySnapshot.exists()) tx.set(doc(unitRef, 'revisions', `v${unit.version}`), unitRaw)
    tx.set(doc(locusRef, 'revisions', `v${locus.version}`), locusRaw)
    tx.set(privateRef(db, uid, 'concepts', bundle.concept.id), materialize(bundle.concept))
    tx.set(encodingRef, materialize(bundle.encoding))
    if (bundle.edge) tx.set(privateRef(db, uid, 'conceptEdges', bundle.edge.id), materialize(bundle.edge))
    for (const card of bundle.cards) { cardSchema.parse(card); tx.set(privateRef(db, uid, 'cards', card.id), { ...materialize(card), dueAt: firestoreTime(card.dueAt) }) }
    tx.update(unitRef, { status: 'ready', primaryConceptId: bundle.concept.id, targetMode: p.mode, targets: bundle.encoding.targets, activeEncodingId: encodingId, version: unit.version + 1 })
    tx.update(locusRef, { state: 'occupied', activeEncodingId: encodingId, usageCountLifetime: locus.usageCountLifetime + 1, version: locus.version + 1 })
    tx.update(draftRef, { status: 'published', publishedEncodingId: encodingId, version: draft.version + 1, updatedAt: serverTimestamp() })
    return encodingId
  })
}

export async function readReviewContext(db, uid, cardId) {
  const card = cardSchema.parse(recordContract(own(await getDocFromServer(privateRef(db, uid, 'cards', cardId)), uid)))
  const [unitSnapshot, encodingSnapshot] = await Promise.all([getDocFromServer(privateRef(db, uid, 'units', card.unitId)), getDocFromServer(privateRef(db, uid, 'encodings', card.encodingId))])
  const unit = unitSchema.parse(recordContract(own(unitSnapshot, uid)))
  const encoding = encodingSchema.parse(recordContract(own(encodingSnapshot, uid)))
  const source = own(await getDocFromServer(privateRef(db, uid, 'sources', unit.sourceId)), uid)
  if (source.lifecycle !== 'active') throw new Error('El manuscrito está archivado.')
  const [conceptSnapshot, locusSnapshot] = await Promise.all([getDocFromServer(privateRef(db, uid, 'concepts', encoding.conceptId)), getDocFromServer(privateRef(db, uid, 'microStations', encoding.locusId))])
  const concept = conceptSchema.parse(recordContract(own(conceptSnapshot, uid)))
  const locus = locusSchema.parse(recordContract(own(locusSnapshot, uid)))
  if (card.lifecycle !== 'active' || encoding.status !== 'active' || unit.activeEncodingId !== encoding.id || locus.activeEncodingId !== encoding.id || encoding.unitId !== unit.id || card.encodingVersion !== encoding.version) throw new MigrationError('inactive-card', 'La tarjeta o su codificación ya no está activa.')
  const { card: fsrsCard } = unpackScheduler(card.scheduler)
  if (fsrsCard.due.getTime() !== card.dueAt.seconds * 1000 + card.dueAt.nanoseconds / 1000000) throw new MigrationError('invalid-schedule', 'La agenda no coincide con su estado FSRS.')
  return { card, unit, encoding, concept, locus }
}

export async function submitReview(db, uid, cardId, expectedVersion, context, rating, requestId, retainResponse = false) {
  validateRating(context, rating)
  const completion = stageCompletion(context)
  const success = recallSucceeded(context)
  const evidence = { rating, highestHint: context.highestHint, attemptedBeforeReveal: context.target === 'verbatim' ? completion.verbatim : completion.meaning && completion.structure && completion.scene, successfulRecall: success, noCriticalError: context.checklist.noCriticalError, stageCompletion: completion, responseRetention: retainResponse ? 'opt-in' : 'metadata-only' }
  if (retainResponse) evidence.attemptText = JSON.stringify(context.attempts)
  const requestHash = await hashValue({ cardId, expectedVersion, ...evidence })
  const eventRef = privateRef(db, uid, 'reviewEvents', requestId)
  const cardRef = privateRef(db, uid, 'cards', cardId)
  const now = Date.now()
  return runTransaction(db, async (tx) => {
    const [prior, cardSnapshot] = await Promise.all([tx.get(eventRef), tx.get(cardRef)])
    if (prior.exists()) {
      const event = own(prior, uid)
      if (event.requestHash !== requestHash) throw new MigrationError('intent-conflict', 'Este intento ya contiene otra calificación.')
      return { dueAt: event.dueAfter, version: event.newCardVersion, reused: true }
    }
    const card = cardSchema.parse(recordContract(own(cardSnapshot, uid)))
    if (card.version !== expectedVersion || card.lifecycle !== 'active' || card.target !== context.target) throw new MigrationError('version-conflict', 'Otra sesión modificó esta tarjeta. Vuelve a abrir el repaso actualizado.')
    const unit = own(await tx.get(privateRef(db, uid, 'units', card.unitId)), uid)
    await requireActiveSource(tx, db, uid, unit.sourceId)
    const next = scheduleReview(card.scheduler, rating, now)
    const event = reviewEventSchema.parse({ id: requestId, userId: uid, schemaVersion: 1, version: 1, createdAt: toTimestamp(now), cardId, target: card.target, clientRequestId: requestId, requestHash, ...evidence, previousCardVersion: card.version, newCardVersion: card.version + 1, reviewedAt: toTimestamp(now), dueBefore: card.dueAt, dueAfter: next.dueAt, schedulerBefore: card.scheduler, schedulerAfter: next.scheduler })
    tx.set(eventRef, { ...materialize(event), reviewedAt: firestoreTime(event.reviewedAt), dueBefore: firestoreTime(event.dueBefore), dueAfter: firestoreTime(event.dueAfter) })
    tx.update(cardRef, { scheduler: next.scheduler, dueAt: firestoreTime(next.dueAt), lastReviewedAt: firestoreTime(event.reviewedAt), version: card.version + 1, lastEventId: requestId })
    return { dueAt: firestoreTime(next.dueAt), version: card.version + 1, reused: false, maximumRating: maximumRating(context) }
  })
}
