import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { createSpace, setSpaceArchived } from '../../src/data/firestore/spacesRepository.js'
import { createSource, createUnit, publishEncoding, readReviewContext, readUnitContext, saveWorkshopDraft, submitReview } from '../../src/data/firestore/cognitiveRepository.js'
import { buildEncodingBundle, emptyWorkshop } from '@icarus/domain/encoding'
import { newRecall, recallReducer } from '@icarus/domain/review'
import { scheduleReview, unpackScheduler } from '@icarus/domain/scheduler'

let environment
const projectId = 'demo-memorizador-solar'
const uid = 'owner-user'
before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'texts', 'legacy-text'), { userId: uid, title: 'Legado', rawText: 'Una idea.', type: 'prosa', chunks: [{ id: 'chunk_0', text: 'Una idea.', order: 0 }], createdAt: serverTimestamp() })
    await setDoc(doc(db, 'users', uid, 'sources', 'source'), { userId: uid, schemaVersion: 1, currentRevisionId: 'revision' })
    await setDoc(doc(db, 'users', uid, 'sources', 'source', 'revisions', 'revision'), { originalText: 'Una idea.' })
  })
})
after(async () => { await environment?.cleanup() })

test('propietario lee fuentes y revisiones privadas; otra cuenta y anónimo no', async () => {
  const owner = environment.authenticatedContext(uid).firestore()
  const other = environment.authenticatedContext('other-user').firestore()
  const anonymous = environment.unauthenticatedContext().firestore()
  await assertSucceeds(getDoc(doc(owner, 'users', uid, 'sources', 'source')))
  await assertSucceeds(getDoc(doc(owner, 'users', uid, 'sources', 'source', 'revisions', 'revision')))
  await assertSucceeds(getDocs(collection(owner, 'users', uid, 'sources')))
  await assertFails(getDoc(doc(other, 'users', uid, 'sources', 'source')))
  await assertFails(getDoc(doc(anonymous, 'users', uid, 'sources', 'source')))
})

test('cliente no crea, modifica ni elimina datos migrados o revisiones inmutables', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await assertFails(setDoc(doc(db, 'users', uid, 'sources', 'new'), { userId: uid }))
  await assertFails(setDoc(doc(db, 'users', uid, 'sources', 'source', 'revisions', 'revision'), { originalText: 'Alterado' }))
  await assertFails(deleteDoc(doc(db, 'users', uid, 'sources', 'source')))
})

test('cliente no ocupa loci, crea tarjetas/logs ni altera feature flags o bloqueo', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  for (const collectionId of ['microStations', 'encodings', 'cards', 'reviewEvents', 'migrationJobs', 'legacyLinks']) {
    await assertFails(setDoc(doc(db, 'users', uid, collectionId, 'forged'), { dueAt: 0, activeEncodingId: 'forged' }))
  }
  await assertFails(setDoc(doc(db, 'users', uid, 'settings', 'profile'), { icarusEnabled: true, legacyWritesLocked: false }))
})

test('sin bloqueo el repaso clásico sigue leyendo y escribiendo su progreso', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(getDocs(query(collection(db, 'texts'), where('userId', '==', uid))))
  await assertSucceeds(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 1, ease: 2.5, nextReview: 1700000000000 }))
  await assertSucceeds(getDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0')))
})

test('perfil existente desbloqueado conserva el clásico', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'settings', 'profile'), { schemaVersion: 1, icarusEnabled: false, legacyWritesLocked: false })
  })
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 2, ease: 2.5, nextReview: 1700000000000 }))
})

const spaceInput = (kind, extra = {}) => ({ kind, name: 'Claustro', cue: 'Puerta de piedra junto al jardín', ordinal: 0, sensoryCues: ['Piedra fría'], ...extra })
const spaceRef = (db, kind, id) => doc(db, 'users', uid, kind, id)
async function hierarchy(db) {
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  await createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro')
  await createSpace(db, uid, spaceInput('locus', { palaceId: 'palace', macroId: 'macro' }), 'locus')
}

test('jerarquía espacial transaccional: reintento idempotente, contadores concurrentes e historial exacto', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  const initial = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  await Promise.all(['macro-a', 'macro-b'].map((id) => createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), id)))
  const palace = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  assert.equal(palace.activeMacroCount, 2)
  assert.equal(palace.version, 3)
  assert.deepEqual((await getDoc(doc(spaceRef(db, 'palaces', 'palace'), 'revisions', 'v1'))).data(), initial)
  assert.equal((await getDocs(collection(spaceRef(db, 'palaces', 'palace'), 'revisions'))).size, 2)
  const retry = await createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro-a')
  assert.equal(retry.reused, true)
  assert.equal((await getDoc(spaceRef(db, 'palaces', 'palace'))).data().activeMacroCount, 2)
  await assert.rejects(createSpace(db, uid, spaceInput('macro', { palaceId: 'palace', name: 'Otro nombre' }), 'macro-a'), { code: 'intent-conflict' })
})

test('archivado reversible conserva IDs, originales y contadores sin borrar documentos', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const original = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: true, expectedVersion: 2 }), { code: 'space-in-use' })
  await setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 })
  assert.equal((await getDoc(spaceRef(db, 'macroStations', 'macro'))).data().activeLocusCount, 0)
  assert.deepEqual((await getDoc(doc(spaceRef(db, 'microStations', 'locus'), 'revisions', 'v1'))).data(), original)
  await setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: true, expectedVersion: 3 })
  await setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: true, expectedVersion: 3 })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: false, expectedVersion: 4 }), { code: 'archived-parent' })
  await setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: false, expectedVersion: 4 })
  await setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: false, expectedVersion: 4 })
  await setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: false, expectedVersion: 2 })
  const restored = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  assert.equal(restored.state, 'free')
  assert.equal(restored.anchorDescription, original.anchorDescription)
  assert.deepEqual(restored.createdAt, original.createdAt)
  assert.equal((await getDoc(spaceRef(db, 'palaces', 'palace'))).data().activeMacroCount, 1)
  assert.equal((await getDoc(spaceRef(db, 'macroStations', 'macro'))).data().activeLocusCount, 1)
  await assertFails(deleteDoc(spaceRef(db, 'microStations', 'locus')))
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 }), { code: 'version-conflict' })
})

test('reglas deniegan hijos huérfanos, doble hijo por contador, cruces de palacio e historial falso', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  await createSpace(db, uid, spaceInput('palace'), 'other-palace')
  const macro = (await getDoc(spaceRef(db, 'macroStations', 'macro'))).data()
  const palaceRef = spaceRef(db, 'palaces', 'palace')
  const palace = (await getDoc(palaceRef)).data()
  await assertFails(setDoc(spaceRef(db, 'macroStations', 'orphan'), { ...macro, id: 'orphan', version: 1, activeLocusCount: 0, createdAt: serverTimestamp() }))
  const double = writeBatch(db)
  double.set(doc(palaceRef, 'revisions', `v${palace.version}`), palace)
  double.update(palaceRef, { version: palace.version + 1, activeMacroCount: palace.activeMacroCount + 1, lastMutation: { action: 'create', childId: 'child-a' } })
  for (const id of ['child-a', 'child-b']) double.set(spaceRef(db, 'macroStations', id), { ...macro, id, version: 1, activeLocusCount: 0, lastMutation: null, createdAt: serverTimestamp() })
  await assertFails(double.commit())
  const locus = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  const crossed = writeBatch(db)
  crossed.set(doc(spaceRef(db, 'macroStations', 'macro'), 'revisions', `v${macro.version}`), macro)
  crossed.update(spaceRef(db, 'macroStations', 'macro'), { version: macro.version + 1, activeLocusCount: macro.activeLocusCount + 1, lastMutation: { action: 'create', childId: 'crossed' } })
  crossed.set(spaceRef(db, 'microStations', 'crossed'), { ...locus, id: 'crossed', palaceId: 'other-palace', createdAt: serverTimestamp() })
  await assertFails(crossed.commit())
  const forged = writeBatch(db)
  forged.set(doc(palaceRef, 'revisions', `v${palace.version}`), { ...palace, title: 'Historia inventada' })
  forged.update(palaceRef, { version: palace.version + 1, lifecycle: 'archived', activeMacroCount: 0 })
  await assertFails(forged.commit())
  await assertFails(updateDoc(palaceRef, { title: 'Ancla cambiada sin revisión' }))
  await assertFails(updateDoc(doc(palaceRef, 'revisions', 'v1'), { title: 'Historia alterada' }))
  await assertFails(deleteDoc(doc(palaceRef, 'revisions', 'v1')))
  const foreign = environment.authenticatedContext('other-user').firestore()
  await assertFails(getDocs(collection(foreign, 'users', uid, 'palaces')))
  await assertFails(getDoc(spaceRef(foreign, 'microStations', 'locus')))
  await assertFails(setDoc(spaceRef(foreign, 'palaces', 'forged'), { ...palace, id: 'forged', version: 1, activeMacroCount: 0, lastMutation: null, createdAt: serverTimestamp() }))
})

test('locus ocupado no se libera ni archiva; no se inventan contadores ni ocupaciones', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const locusRef = spaceRef(db, 'microStations', 'locus')
  await assertFails(updateDoc(locusRef, { state: 'occupied', activeEncodingId: 'encoding' }))
  const palaceRef = spaceRef(db, 'palaces', 'palace')
  const palace = (await getDoc(palaceRef)).data()
  const batch = writeBatch(db)
  batch.set(doc(palaceRef, 'revisions', `v${palace.version}`), palace)
  batch.update(palaceRef, { activeMacroCount: 0, version: palace.version + 1 })
  await assertFails(batch.commit())
  await environment.withSecurityRulesDisabled(async (context) => { await updateDoc(spaceRef(context.firestore(), 'microStations', 'locus'), { state: 'occupied', activeEncodingId: 'encoding', usageCountLifetime: 1 }) })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 }), { code: 'space-in-use' })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: false, expectedVersion: 1 }), { code: 'space-in-use' })
  const occupied = (await getDoc(locusRef)).data()
  const release = writeBatch(db)
  release.set(doc(locusRef, 'revisions', 'v1'), occupied)
  release.update(locusRef, { state: 'free', activeEncodingId: null, version: 2 })
  await assertFails(release.commit())
  assert.equal((await getDoc(locusRef)).data().activeEncodingId, 'encoding')
})

test('creación y archivado concurrentes no dejan una estación activa bajo un padre archivado', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  const results = await Promise.allSettled([
    createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro'),
    setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: true, expectedVersion: 1 }),
  ])
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1)
  const palace = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  const macro = await getDoc(spaceRef(db, 'macroStations', 'macro'))
  assert.equal(palace.activeMacroCount, macro.exists() ? 1 : 0)
  assert.equal(palace.lifecycle, macro.exists() ? 'active' : 'archived')
})

test('bloqueo confiable protege textos/progreso y sigue permitiendo respaldo de lectura', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'settings', 'profile'), { schemaVersion: 1, icarusEnabled: false, legacyWritesLocked: true })
  })
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(getDoc(doc(db, 'texts', 'legacy-text')))
  await assertSucceeds(getDocs(collection(db, 'texts', 'legacy-text', 'progress')))
  await assertFails(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 1, ease: 2.5, nextReview: 1700000000000 }))
  await assertFails(deleteDoc(doc(db, 'texts', 'legacy-text')))
  await assertFails(deleteDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0')))
  const snapshot = await getDoc(doc(db, 'texts', 'legacy-text'))
  assert.equal(snapshot.data().rawText, 'Una idea.')
})

function validWorkshop(extra = {}) {
  return { ...emptyWorkshop(), sourceReviewed: true, mode: 'dual', proposition: 'Una conclusión depende de sus razones.', foundation: 'Es la primera idea de este recorrido.', palaceId: 'palace', macroId: 'macro', locusId: 'locus', agent: 'Un monje', action: 'Eleva una conclusión sobre dos columnas', symbol: 'Dos columnas', distinctiveCue: 'Las columnas cantan', mapping: 'Las columnas son razones y sostienen la conclusión.', prompt: '¿Qué relación representa este lugar?', distinction: 'Ninguna escena vecina tiene columnas que canten.', mentalRehearsal: true, sceneDistinguished: true, entranceAttempted: true, entrancePassed: true, meaningConfirmed: true, ...extra }
}
async function prepareLearning(db, sourceId = 'new-source', text = 'Una conclusión se sostiene en sus razones.', extra = {}) {
  await createSource(db, uid, { title: 'Manuscrito', kind: 'prose', originalText: text, segmentationMode: 'sentences' }, sourceId)
  const unitId = await createUnit(db, uid, sourceId, { revisionId: 'r1', startOffset: 0, endOffset: text.length, ordinal: 0 })
  const version = await saveWorkshopDraft(db, uid, unitId, validWorkshop(extra), 7, 0)
  return { unitId, version, encodingId: `${unitId}_e1` }
}
function successfulContext(target) {
  let state = newRecall(target)
  state = recallReducer(state, { type: 'NEXT' })
  while (state.phase !== 'REVEAL') state = recallReducer(state, { type: 'NEXT', attempt: 'Recuerdo fiel, con un ejemplo propio.' })
  for (const key of ['mainIdea', 'explanation', 'exact', 'noCriticalError']) state = recallReducer(state, { type: 'CHECK', key, value: true })
  return recallReducer(state, { type: 'NEXT' })
}

test('ingesta íntegra: revisión y unidades inmutables con selección exacta, sin tocar legado', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  const raw = '  Un símbolo 🌞.\r\nSegundo verso.  '
  await createSource(db, uid, { title: 'Origen', kind: 'poetry', originalText: raw, segmentationMode: 'verses' }, 'origin')
  const end = raw.indexOf('\r')
  const unitId = await createUnit(db, uid, 'origin', { revisionId: 'r1', startOffset: 2, endOffset: end, ordinal: 0 })
  const context = await readUnitContext(db, uid, unitId)
  assert.equal(context.revision.originalText, raw)
  assert.equal(context.unit.text, raw.slice(2, end))
  assert.equal(context.unit.status, 'needs_concept')
  await assertFails(updateDoc(spaceRef(db, 'sources', 'origin'), { title: 'Reescritura' }))
  await assertFails(updateDoc(doc(spaceRef(db, 'sources', 'origin'), 'revisions', 'r1'), { originalText: 'Reescritura' }))
  assert.equal((await getDoc(doc(db, 'texts', 'legacy-text'))).data().rawText, 'Una idea.')
})

test('Taller obligatorio: fallo no publica; gate completo vincula tres agendas y retry no duplica', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const prepared = await prepareLearning(db, 'new-source', undefined, { entrancePassed: false })
  await assert.rejects(publishEncoding(db, uid, prepared.unitId, prepared.version), /examen de entrada/)
  assert.equal((await getDocs(collection(db, 'users', uid, 'cards'))).size, 0)
  assert.equal((await getDoc(spaceRef(db, 'microStations', 'locus'))).data().state, 'free')
  const v2 = await saveWorkshopDraft(db, uid, prepared.unitId, validWorkshop(), 7, 1)
  assert.equal(await publishEncoding(db, uid, prepared.unitId, v2), prepared.encodingId)
  assert.equal(await publishEncoding(db, uid, prepared.unitId, v2), prepared.encodingId)
  const context = await readUnitContext(db, uid, prepared.unitId)
  assert.equal(context.unit.activeEncodingId, prepared.encodingId)
  assert.equal(context.draft.status, 'published')
  const cards = await getDocs(collection(db, 'users', uid, 'cards'))
  assert.equal(cards.size, 3)
  for (const card of cards.docs) assert.equal(unpackScheduler(card.data().scheduler).card.reps, 0)
  assert.equal((await getDoc(spaceRef(db, 'microStations', 'locus'))).data().usageCountLifetime, 1)
  await assertFails(deleteDoc(spaceRef(db, 'encodings', prepared.encodingId)))
  await assertFails(updateDoc(spaceRef(db, 'concepts', `${prepared.encodingId}_concept`), { canonicalProposition: 'Otro significado' }))
  await assert.rejects(saveWorkshopDraft(db, uid, prepared.unitId, validWorkshop(), 7, context.draft.version), { code: 'published-unit' })
})

test('publicación concurrente en un locus: solo una codificación activa y ningún resto parcial', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const a = await prepareLearning(db, 'source-a')
  const b = await prepareLearning(db, 'source-b', 'Otra idea tiene un fundamento.')
  const results = await Promise.allSettled([publishEncoding(db, uid, a.unitId, a.version), publishEncoding(db, uid, b.unitId, b.version)])
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal((await getDocs(collection(db, 'users', uid, 'encodings'))).size, 1)
  assert.equal((await getDocs(collection(db, 'users', uid, 'cards'))).size, 3)
  assert.equal((await getDocs(collection(db, 'users', uid, 'concepts'))).size, 1)
  const units = (await getDocs(collection(db, 'users', uid, 'units'))).docs.map((entry) => entry.data())
  assert.equal(units.filter((entry) => entry.status === 'ready').length, 1)
})

test('repaso idempotente por objetivo con estados completos, eventos inmutables y privacidad por defecto', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const prepared = await prepareLearning(db)
  await publishEncoding(db, uid, prepared.unitId, prepared.version)
  const cardId = `${prepared.encodingId}_concept`
  await readReviewContext(db, uid, cardId)
  const context = successfulContext('concept')
  await submitReview(db, uid, cardId, 1, context, 'good', 'review-1')
  const duplicate = await submitReview(db, uid, cardId, 1, context, 'good', 'review-1')
  assert.equal(duplicate.reused, true)
  const reviewed = (await getDoc(spaceRef(db, 'cards', cardId))).data()
  assert.equal(reviewed.version, 2)
  assert.equal(unpackScheduler(reviewed.scheduler).card.reps, 1)
  assert.equal((await getDoc(spaceRef(db, 'cards', `${prepared.encodingId}_verbatim`))).data().version, 1)
  const eventRef = spaceRef(db, 'reviewEvents', 'review-1')
  const event = (await getDoc(eventRef)).data()
  assert.equal(event.responseRetention, 'metadata-only')
  assert.equal(Object.hasOwn(event, 'attemptText'), false)
  assert.deepEqual(event.schedulerAfter, reviewed.scheduler)
  await assertFails(updateDoc(eventRef, { rating: 'easy' }))
  await assertFails(deleteDoc(eventRef))
  await assert.rejects(submitReview(db, uid, cardId, 1, context, 'good', 'stale-review'), { code: 'version-conflict' })
  assert.equal((await getDocs(collection(db, 'users', uid, 'reviewEvents'))).size, 1)
  await assertFails(updateDoc(spaceRef(db, 'cards', cardId), { version: 3, dueAt: Timestamp.now() }))
})

test('reglas comprueban topes de ayuda y acoplamiento evento/tarjeta aunque el cliente evite el servicio', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const prepared = await prepareLearning(db)
  await publishEncoding(db, uid, prepared.unitId, prepared.version)
  const cardId = `${prepared.encodingId}_concept`
  const ref = spaceRef(db, 'cards', cardId)
  const card = (await getDoc(ref)).data()
  const now = Date.now()
  const next = scheduleReview(card.scheduler, 'good', now)
  const due = new Timestamp(next.dueAt.seconds, next.dueAt.nanoseconds)
  const event = { id: 'forged-review', userId: uid, schemaVersion: 1, version: 1, createdAt: serverTimestamp(), cardId, target: 'concept', clientRequestId: 'forged-review', requestHash: `sha256:${'a'.repeat(64)}`, rating: 'good', highestHint: 3, attemptedBeforeReveal: true, successfulRecall: true, noCriticalError: true, stageCompletion: { scene: true, meaning: true, structure: true, verbatim: false }, previousCardVersion: 1, newCardVersion: 2, reviewedAt: Timestamp.fromMillis(now), dueBefore: card.dueAt, dueAfter: due, responseRetention: 'metadata-only', schedulerBefore: card.scheduler, schedulerAfter: next.scheduler }
  const attempt = writeBatch(db)
  attempt.set(spaceRef(db, 'reviewEvents', event.id), event)
  attempt.update(ref, { version: 2, lastEventId: event.id, lastReviewedAt: event.reviewedAt, dueAt: due, scheduler: next.scheduler })
  await assertFails(attempt.commit())
  await assertFails(setDoc(spaceRef(db, 'reviewEvents', event.id), { ...event, highestHint: 0 }))
  assert.equal((await getDoc(ref)).data().version, 1)
  const failed = recallReducer(newRecall('concept'), { type: 'FAIL' })
  const rate = recallReducer(failed, { type: 'NEXT' })
  await submitReview(db, uid, cardId, 1, rate, 'again', 'failed-recall')
  assert.equal((await getDoc(spaceRef(db, 'reviewEvents', 'failed-recall'))).data().successfulRecall, false)
})

test('argumento enlazado en modo dual publica también su arista y supera los límites de reglas', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const base = await prepareLearning(db, 'foundation')
  await publishEncoding(db, uid, base.unitId, base.version)
  await createSpace(db, uid, spaceInput('locus', { palaceId: 'palace', macroId: 'macro', name: 'Atril' }), 'locus-linked')
  const linked = await prepareLearning(db, 'argument', 'Todos los hombres son mortales. Sócrates es hombre. Sócrates es mortal.', { conceptKind: 'argument', premises: 'Todos los hombres son mortales.\nSócrates es hombre.', conclusion: 'Sócrates es mortal.', why: 'La pertenencia de Sócrates a los hombres permite aplicar la premisa universal.', locusId: 'locus-linked', foundational: false, linkedConceptId: `${base.encodingId}_concept`, linkExplanation: 'Este argumento ejemplifica la dependencia de una conclusión respecto de sus razones.' })
  await publishEncoding(db, uid, linked.unitId, linked.version)
  const edge = (await getDoc(spaceRef(db, 'conceptEdges', `${linked.encodingId}_edge`))).data()
  assert.equal(edge.fromConceptId, `${linked.encodingId}_concept`)
  assert.equal(edge.toConceptId, `${base.encodingId}_concept`)
  assert.equal((await getDocs(collection(db, 'users', uid, 'cards'))).size, 6)
  await assertFails(updateDoc(spaceRef(db, 'conceptEdges', edge.id), { fromConceptId: edge.toConceptId }))
})

test('el gate del examen también se exige en reglas frente a una publicación directa falsificada', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const prepared = await prepareLearning(db, 'false-gate', undefined, { entrancePassed: false })
  const context = await readUnitContext(db, uid, prepared.unitId)
  const locusRef = spaceRef(db, 'microStations', 'locus')
  const locus = (await getDoc(locusRef)).data()
  const bundle = buildEncodingBundle({ userId: uid, unit: context.unit, revision: context.revision, payload: validWorkshop(), encodingId: prepared.encodingId, draftId: prepared.unitId, requestHash: `sha256:${'b'.repeat(64)}` })
  const batch = writeBatch(db)
  const fresh = (data) => ({ ...data, createdAt: serverTimestamp() })
  batch.set(doc(locusRef, 'revisions', `v${locus.version}`), locus)
  batch.set(spaceRef(db, 'concepts', bundle.concept.id), fresh(bundle.concept))
  batch.set(spaceRef(db, 'encodings', bundle.encoding.id), fresh(bundle.encoding))
  for (const card of bundle.cards) batch.set(spaceRef(db, 'cards', card.id), { ...fresh(card), dueAt: new Timestamp(card.dueAt.seconds, card.dueAt.nanoseconds) })
  batch.update(spaceRef(db, 'units', prepared.unitId), { status: 'ready', activeEncodingId: prepared.encodingId, primaryConceptId: bundle.concept.id, targets: bundle.encoding.targets, targetMode: 'dual', version: 2 })
  batch.update(locusRef, { state: 'occupied', activeEncodingId: prepared.encodingId, usageCountLifetime: 1, version: locus.version + 1 })
  batch.update(spaceRef(db, 'encodingDrafts', prepared.unitId), { status: 'published', publishedEncodingId: prepared.encodingId, version: 2, updatedAt: serverTimestamp() })
  await assertFails(batch.commit())
  assert.equal((await getDoc(locusRef)).data().state, 'free')
  assert.equal((await getDocs(collection(db, 'users', uid, 'cards'))).size, 0)
})

test('las respuestas opt-in quedan privadas y no se permite insertarlas en eventos metadata-only', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const prepared = await prepareLearning(db)
  await publishEncoding(db, uid, prepared.unitId, prepared.version)
  await submitReview(db, uid, `${prepared.encodingId}_explanation`, 1, successfulContext('explanation'), 'good', 'consented', true)
  const ref = spaceRef(db, 'reviewEvents', 'consented')
  const event = (await getDoc(ref)).data()
  assert.equal(event.responseRetention, 'opt-in')
  assert.ok(event.attemptText.includes('Recuerdo fiel'))
  const conceptRef = spaceRef(db, 'cards', `${prepared.encodingId}_concept`)
  const conceptCard = (await getDoc(conceptRef)).data()
  const contradictory = { ...event, id: 'not-consented', clientRequestId: 'not-consented', cardId: conceptCard.id, target: 'concept', createdAt: serverTimestamp(), responseRetention: 'metadata-only', dueBefore: conceptCard.dueAt, schedulerBefore: conceptCard.scheduler }
  const contradiction = writeBatch(db)
  contradiction.set(spaceRef(db, 'reviewEvents', contradictory.id), contradictory)
  contradiction.update(conceptRef, { version: 2, dueAt: event.dueAfter, scheduler: event.schedulerAfter, lastReviewedAt: event.reviewedAt, lastEventId: contradictory.id })
  await assertFails(contradiction.commit())
  assert.equal((await getDoc(conceptRef)).data().version, 1)
  const other = environment.authenticatedContext('other-user').firestore()
  await assertFails(getDoc(spaceRef(other, 'reviewEvents', 'consented')))
  await assertFails(getDoc(spaceRef(other, 'cards', `${prepared.encodingId}_explanation`)))
})
