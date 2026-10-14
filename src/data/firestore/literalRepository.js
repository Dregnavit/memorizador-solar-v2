import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { hashValue, toTimestamp } from '@icarus/domain/codec'
import { comparisonProfileSchema, literalProgramSchema, literalCardSchema, compareLiteral, literalRatingCap } from '@icarus/domain/literal'
import { sourceRevisionSchema, unitSchema, validateUnitAgainstRevision } from '@icarus/domain/schemas'
import { newScheduler, scheduleReview } from '@icarus/domain/scheduler'
import { createUnit, privateRef, recordContract, firestoreTime } from './cognitiveRepository.js'
import { requireActiveSource } from './sourceLifecycleRepository.js'

const own = (snapshot, uid) => { if (!snapshot.exists() || snapshot.data().userId !== uid) throw new Error('Documento no disponible para esta cuenta.'); return snapshot.data() }
export async function prepareLiteral(db, uid, sourceId, revision, segments, profile, goal) {
  sourceRevisionSchema.parse(recordContract(revision)); comparisonProfileSchema.parse(profile)
  if (!Array.isArray(segments) || !segments.length || segments.length > 200 || !['literal', 'combined'].includes(goal)) throw new Error('Preparación no válida.')
  let previous = 0
  for (const segment of segments) {
    if (segment.startOffset !== previous || !Number.isInteger(segment.endOffset) || segment.endOffset <= previous || segment.endOffset > revision.originalText.length) throw new Error('Los segmentos deben cubrir el original, sin huecos ni solapamientos.')
    previous = segment.endOffset
  }
  if (previous !== revision.originalText.length) throw new Error('La preparación no cubre todo el original.')
  const requestHash = await hashValue({ sourceId, revisionId: revision.id, segments: segments.map(({ startOffset, endOffset }) => ({ startOffset, endOffset })), profile, goal })
  const id = `lp_${requestHash.slice(7)}`
  const unitIds = []
  for (const segment of segments) unitIds.push(await createUnit(db, uid, sourceId, { ...segment, revisionId: revision.id, ordinal: segment.startOffset }))
  for (const unitId of unitIds) await runTransaction(db, async (tx) => {
    const membership = privateRef(db, uid, 'literalMemberships', unitId)
    const previous = await tx.get(membership)
    await requireActiveSource(tx, db, uid, sourceId)
    if (!previous.exists()) tx.set(membership, { id: unitId, unitId, userId: uid, sourceId, sourceRevisionId: revision.id, createdAt: serverTimestamp() })
  })
  const program = literalProgramSchema.parse({ id, userId: uid, schemaVersion: 2, version: 1, createdAt: toTimestamp(Date.now()), sourceId, sourceRevisionId: revision.id, goal, profile, unitIds, ranges: segments.map(({ startOffset, endOffset }) => ({ startOffset, endOffset })), contentHash: revision.contentHash, requestHash })
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(privateRef(db, uid, 'literalPrograms', id))
    await requireActiveSource(tx, db, uid, sourceId)
    if (!existing.exists()) tx.set(privateRef(db, uid, 'literalPrograms', id), { ...program, createdAt: serverTimestamp() })
    else if (own(existing, uid).requestHash !== requestHash) throw new Error('Conflicto de preparación.')
  })
  return program
}
export async function readLiteralContext(db, uid, programId) {
  const program = literalProgramSchema.parse(recordContract(own(await getDocFromServer(privateRef(db, uid, 'literalPrograms', programId)), uid)))
  const ref = privateRef(db, uid, 'sources', program.sourceId)
  const [source, revision] = await Promise.all([getDocFromServer(ref), getDocFromServer(doc(ref, 'revisions', program.sourceRevisionId))])
  const sourceData = own(source, uid)
  if (sourceData.lifecycle !== 'active') throw new Error('El manuscrito está archivado.')
  const revisionData = sourceRevisionSchema.parse(recordContract(own(revision, uid)))
  if (program.contentHash !== revisionData.contentHash || program.ranges[0].startOffset !== 0 || program.ranges.at(-1).endOffset !== revisionData.originalText.length || program.ranges.some((range, i) => range.endOffset <= range.startOffset || (i && range.startOffset !== program.ranges[i - 1].endOffset))) throw new Error('La preparación no corresponde al original inmutable.')
  if (program.unitIds.length !== program.ranges.length) throw new Error('El número de unidades no coincide con los cortes.')
  for (let offset = 0; offset < program.unitIds.length; offset += 20) await Promise.all(program.unitIds.slice(offset, offset + 20).map(async (id, i) => {
    const unit = unitSchema.parse(recordContract(own(await getDocFromServer(privateRef(db, uid, 'units', id)), uid)))
    validateUnitAgainstRevision(unit, revisionData)
    const range = program.ranges[offset + i]
    if (unit.startOffset !== range.startOffset || unit.endOffset !== range.endOffset) throw new Error('La unidad no corresponde al corte publicado.')
  }))
  return { program, revision: revisionData, source: sourceData }
}
export function literalExerciseText(context, exercise) {
  const { ranges } = context.program
  if (!Number.isInteger(exercise.start) || !Number.isInteger(exercise.end) || exercise.start < 0 || exercise.start >= exercise.end || exercise.end > ranges.length || (exercise.scope === 'whole' && (exercise.start !== 0 || exercise.end !== ranges.length))) throw new Error('Rango de ejercicio no válido.')
  return context.revision.originalText.slice(ranges[exercise.start].startOffset, ranges[exercise.end - 1].endOffset)
}
export async function ensureLiteralCard(db, uid, context, exercise) {
  literalExerciseText(context, exercise)
  const id = `${context.program.id}_${exercise.scope}_${exercise.start}_${exercise.end}`
  const ref = privateRef(db, uid, 'literalCards', id)
  try { return await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref)
    await requireActiveSource(tx, db, uid, context.program.sourceId)
    if (existing.exists()) return literalCardSchema.parse(recordContract(own(existing, uid)))
    const now = Date.now()
    const card = literalCardSchema.parse({ id, userId: uid, schemaVersion: 2, version: 1, createdAt: toTimestamp(now), sourceId: context.program.sourceId, programId: context.program.id, exerciseId: id, scope: exercise.scope, start: exercise.start, end: exercise.end, lifecycle: 'active', scheduler: newScheduler(now), dueAt: toTimestamp(now), lastReviewedAt: null, lastEventId: null })
    tx.set(privateRef(db, uid, 'literalExercises', id), { id, userId: uid, schemaVersion: 2, version: 1, createdAt: serverTimestamp(), sourceId: card.sourceId, programId: card.programId, sourceRevisionId: context.revision.id, start: exercise.start, end: exercise.end, scope: exercise.scope })
    tx.set(ref, { ...card, createdAt: serverTimestamp(), dueAt: firestoreTime(card.dueAt) })
    return card
  }) } catch (error) {
    // React StrictMode and two devices can race to create the same immutable exercise.
    // The emulator can report this contention as permission-denied instead of ABORTED.
    if (error.code !== 'permission-denied') throw error
    const snapshot = await getDocFromServer(ref)
    const source = await getDocFromServer(privateRef(db, uid, 'sources', context.program.sourceId))
    if (!snapshot.exists() || !source.exists() || source.data().lifecycle !== 'active') throw error
    const existing = literalCardSchema.parse(recordContract(own(snapshot, uid)))
    if (existing.programId !== context.program.id || existing.start !== exercise.start || existing.end !== exercise.end || existing.scope !== exercise.scope) throw error
    return existing
  }
}
export async function recordLiteralHint(db, uid, card, sessionId, level) {
  if (![1, 2, 3].includes(level)) throw new Error('Pista no válida.')
  const ref = privateRef(db, uid, 'literalHints', `${sessionId}_${level}`)
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref)
    await requireActiveSource(tx, db, uid, card.sourceId)
    if (existing.exists() && (existing.data().exerciseId !== card.id || existing.data().level !== level)) throw new Error('La pista pertenece a otro intento.')
    if (!existing.exists()) tx.set(ref, { id: ref.id, userId: uid, sourceId: card.sourceId, programId: card.programId, exerciseId: card.id, sessionId, level, createdAt: serverTimestamp() })
  })
}
export async function submitLiteralReview(db, uid, context, card, attempt, evidence, rating, requestId, retain = false) {
  if (card.programId !== context.program.id || card.sourceId !== context.program.sourceId) throw new Error('La tarjeta no corresponde a esta preparación.')
  const reference = literalExerciseText(context, card)
  const comparison = evidence.verification === 'manual' ? { complete: true, conforms: false, rawExact: false, lexicalSimilarity: null, ambiguous: false } : compareLiteral(reference, attempt, context.program.profile, { language: context.revision.language })
  const cap = literalRatingCap({ ...evidence, ...comparison })
  const ratings = ['again', 'hard', 'good', 'easy']
  if (!ratings.includes(rating) || ratings.indexOf(rating) > ratings.indexOf(cap)) throw new Error('La nota supera lo permitido por el resultado o las ayudas.')
  const requestHash = await hashValue({ cardId: card.id, version: card.version, attempt, evidence, rating, retain })
  const eventRef = privateRef(db, uid, 'literalAttempts', requestId); const cardRef = privateRef(db, uid, 'literalCards', card.id)
  return runTransaction(db, async (tx) => {
    const [previous, snapshot] = await Promise.all([tx.get(eventRef), tx.get(cardRef)])
    if (previous.exists()) { if (own(previous, uid).requestHash !== requestHash) throw new Error('El intento ya contiene otro resultado.'); return previous.data() }
    await requireActiveSource(tx, db, uid, card.sourceId)
    const current = literalCardSchema.parse(recordContract(own(snapshot, uid)))
    if (current.version !== card.version) throw new Error('El ejercicio cambió en otra sesión. Vuelve a abrirlo antes de guardar.')
    const now = Date.now(); const next = scheduleReview(current.scheduler, rating, now)
    const event = { id: requestId, userId: uid, schemaVersion: 2, version: 1, sourceId: current.sourceId, programId: current.programId, cardId: current.id, exerciseId: current.exerciseId, scope: current.scope, requestHash, rating, cap, verification: evidence.verification, highestHint: evidence.highestHint, revealed: evidence.revealed, manualCorrect: evidence.verification === 'manual' && evidence.manualCorrect === true, complete: comparison.complete, conforms: comparison.conforms, rawExact: comparison.rawExact, lexicalSimilarity: comparison.lexicalSimilarity, ambiguous: comparison.ambiguous, profile: context.program.profile, previousCardVersion: current.version, newCardVersion: current.version + 1, schedulerBefore: current.scheduler, schedulerAfter: next.scheduler, dueBefore: firestoreTime(current.dueAt), dueAfter: firestoreTime(next.dueAt), responseRetention: retain ? 'opt-in' : 'metadata-only', ...(retain ? { attemptText: attempt } : {}), createdAt: serverTimestamp() }
    tx.set(eventRef, event)
    tx.update(cardRef, { version: current.version + 1, scheduler: next.scheduler, dueAt: firestoreTime(next.dueAt), lastReviewedAt: firestoreTime(toTimestamp(now)), lastEventId: requestId })
    return event
  })
}
export async function associateLiteralLocus(db, uid, context, exercise, locusId, scene = '') {
  literalExerciseText(context, exercise)
  if (typeof scene !== 'string' || scene.length > 4000) throw new Error('La imagen opcional admite hasta 4.000 caracteres.')
  const id = `lb_${(await hashValue({ programId: context.program.id, start: exercise.start, end: exercise.end })).slice(7)}`
  const ref = privateRef(db, uid, 'literalBindings', id); const locusRef = privateRef(db, uid, 'microStations', locusId)
  return runTransaction(db, async (tx) => {
    const [existing, snapshot] = await Promise.all([tx.get(ref), tx.get(locusRef)])
    await requireActiveSource(tx, db, uid, context.program.sourceId)
    if (existing.exists()) { if (existing.data().locusId !== locusId) throw new Error('Este grupo ya tiene un locus. No se sustituye una asociación publicada.'); return id }
    const locus = own(snapshot, uid)
    const [macro, palace] = await Promise.all([tx.get(privateRef(db, uid, 'macroStations', locus.macroId)), tx.get(privateRef(db, uid, 'palaces', locus.palaceId))])
    if (locus.state !== 'free' || locus.activeEncodingId || locus.activeBinding || own(macro, uid).lifecycle !== 'active' || own(palace, uid).lifecycle !== 'active') throw new Error('El locus ya no está libre o su ruta está archivada.')
    tx.set(doc(locusRef, 'revisions', `v${locus.version}`), locus)
    tx.update(locusRef, { schemaVersion: 2, version: locus.version + 1, state: 'occupied', activeEncodingId: null, activeBinding: { kind: 'literal', id }, usageCountLifetime: locus.usageCountLifetime + 1 })
    tx.set(ref, { id, userId: uid, schemaVersion: 2, version: 1, createdAt: serverTimestamp(), sourceId: context.program.sourceId, programId: context.program.id, sourceRevisionId: context.revision.id, start: exercise.start, end: exercise.end, locusId, purpose: 'sequence', scene })
    return id
  })
}
