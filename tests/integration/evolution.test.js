import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { initializeFirestore } from 'firebase-admin/firestore'
import { doc, getDocFromServer, setDoc, serverTimestamp, updateDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { createSource, createUnit, privateRef, readUnitContext, saveWorkshopDraft, publishEncoding } from '../../src/data/firestore/cognitiveRepository.js'
import { setSourceArchived } from '../../src/data/firestore/sourceLifecycleRepository.js'
import { prepareLiteral, readLiteralContext, ensureLiteralCard, submitLiteralReview, associateLiteralLocus, recordLiteralHint } from '../../src/data/firestore/literalRepository.js'
import { createSpace, finishLocusRest } from '../../src/data/firestore/spacesRepository.js'
import { STRICT_PROFILE, segmentLiteral } from '@icarus/domain/literal'
import { emptyWorkshop } from '@icarus/domain/encoding'
import { preview, startDeletion, stepDeletion, cancelDeletion } from '../../server/manuscripts/service.js'
import { authenticate, emulatorCredential } from '../../server/firebase.js'
import handler from '../../api/manuscripts.js'

const uid = 'evolution-owner'; const projectId = 'demo-memorizador-solar'
let environment, adminApp, admin
before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  adminApp = initializeApp({ projectId, credential: emulatorCredential(projectId) }, 'evolution-tests'); admin = initializeFirestore(adminApp, { preferRest: true })
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => { await environment.clearFirestore() })
after(async () => { await environment?.cleanup(); await deleteApp(adminApp) })
async function setup(id = 'source-one') {
  const db = environment.authenticatedContext(uid).firestore()
  const text = 'La nube pasa.\r\nEl viento gira.'
  await createSource(db, uid, { title: 'Ejemplo neutral', originalText: text, kind: 'poetry', segmentationMode: 'verses', language: 'es', edition: 'Edición de prueba', learningGoal: 'combined' }, id)
  const rev = (await getDocFromServer(doc(privateRef(db, uid, 'sources', id), 'revisions', 'r1'))).data()
  const program = await prepareLiteral(db, uid, id, rev, segmentLiteral(text, 'verses'), { ...STRICT_PROFILE, whitespace: 'collapse' }, 'combined')
  const context = await readLiteralContext(db, uid, program.id)
  const card = await ensureLiteralCard(db, uid, context, { start: 0, end: 1, scope: 'segment' })
  return { db, program, context, card, text, sourceId: id }
}
async function spaces(db) {
  await createSpace(db, uid, { kind: 'palace', name: 'Edificio imaginario', cue: '', ordinal: 0 }, 'palace')
  await createSpace(db, uid, { kind: 'macro', palaceId: 'palace', name: 'Sala', cue: 'Entrada amplia', ordinal: 0 }, 'macro')
  await createSpace(db, uid, { kind: 'locus', palaceId: 'palace', macroId: 'macro', name: 'Umbral', cue: 'Arco de piedra', ordinal: 0, sensoryCues: [] }, 'locus')
}
const evidence = { verification: 'automatic', highestHint: 0, revealed: false, manualCorrect: false }
test('revisión v2, preparación idempotente, unidades compartidas y FSRS literal con privacidad', async () => {
  const { db, context, program, card } = await setup()
  assert.equal(context.revision.schemaVersion, 2); assert.equal(context.revision.edition, 'Edición de prueba')
  const same = await prepareLiteral(db, uid, context.program.sourceId, context.revision, segmentLiteral(context.revision.originalText, 'verses'), program.profile, 'combined')
  assert.deepEqual(same.unitIds, program.unitIds)
  await submitLiteralReview(db, uid, context, card, 'La nube pasa.', evidence, 'good', 'review-one')
  const updated = (await getDocFromServer(privateRef(db, uid, 'literalCards', card.id))).data()
  assert.equal(updated.version, 2); assert.notDeepEqual(updated.scheduler, card.scheduler)
  await submitLiteralReview(db, uid, context, card, 'La nube pasa.', evidence, 'good', 'review-one')
  assert.equal((await getDocFromServer(privateRef(db, uid, 'literalCards', card.id))).data().version, 2)
  assert.equal('attemptText' in (await getDocFromServer(privateRef(db, uid, 'literalAttempts', 'review-one'))).data(), false)
  assert.equal((await readUnitContext(db, uid, program.unitIds[0])).unit.primaryConceptId, null)
  await assert.rejects(submitLiteralReview(db, uid, context, card, 'Otra frase.', evidence, 'easy', 'bad-grade'))
  const other = environment.authenticatedContext('another-owner').firestore()
  await assertFails(getDocs(collection(other, 'users', uid, 'literalCards')))
  await assertFails(updateDoc(privateRef(db, uid, 'sources', context.source.id), { title: 'Cambio no autorizado' }))
})
test('archivo revoca sesiones abiertas, publicación y repaso; restaurar no altera agendas', async () => {
  const { db, context, card, program } = await setup()
  const before = (await getDocFromServer(privateRef(db, uid, 'literalCards', card.id))).data()
  await setSourceArchived(db, uid, context.source.id, true, 'archive-one')
  await assert.rejects(submitLiteralReview(db, uid, context, card, 'La nube pasa.', evidence, 'good', 'blocked-review'), /archivado/)
  await assert.rejects(readLiteralContext(db, uid, program.id), /archivado/)
  await assert.rejects(saveWorkshopDraft(db, uid, program.unitIds[0], emptyWorkshop(), 0, 0), /archivado/)
  await assertFails(updateDoc(privateRef(db, uid, 'literalCards', card.id), { version: 2 }))
  await setSourceArchived(db, uid, context.source.id, false, 'restore-one')
  assert.deepEqual((await getDocFromServer(privateRef(db, uid, 'literalCards', card.id))).data(), before)
  await submitLiteralReview(db, uid, context, card, 'La nube pasa.', evidence, 'good', 'restored-review')
})
test('ocupación literal tipada excluye codificación conceptual, conserva contadores y admite descanso explícito', async () => {
  const { db, context, program } = await setup(); await spaces(db)
  await associateLiteralLocus(db, uid, context, { start: 0, end: 2, scope: 'section' }, 'locus', '')
  const locus = (await getDocFromServer(privateRef(db, uid, 'microStations', 'locus'))).data()
  assert.equal(locus.schemaVersion, 2); assert.equal(locus.state, 'occupied'); assert.equal(locus.activeEncodingId, null); assert.equal(locus.activeBinding.kind, 'literal')
  await assert.rejects(associateLiteralLocus(db, uid, context, { start: 0, end: 1, scope: 'segment' }, 'locus'), /libre/)
  const payload = { ...emptyWorkshop(), locusId: 'locus', macroId: 'macro', palaceId: 'palace' }
  await saveWorkshopDraft(db, uid, program.unitIds[0], payload, 0, 0)
  await assert.rejects(publishEncoding(db, uid, program.unitIds[0], 1), /libre/)
  await setSourceArchived(db, uid, context.source.id, true, 'archive-two')
  const inventory = await preview(admin, uid, context.source.id)
  let job = await startDeletion(admin, uid, context.source.id, inventory.fingerprint, 'delete-spaces')
  while (job.state !== 'completed') job = await stepDeletion(admin, uid, job.id)
  const resting = (await getDocFromServer(privateRef(db, uid, 'microStations', 'locus'))).data()
  assert.equal(resting.state, 'cooling'); assert.equal(resting.activeBinding, null); assert.equal(resting.usageCountLifetime, 1)
  await finishLocusRest(db, uid, 'locus', resting.version)
  assert.equal((await getDocFromServer(privateRef(db, uid, 'microStations', 'locus'))).data().state, 'free')
})
test('eliminación recorre subcolecciones y más de una página, resiste interrupción y conserva otras cuentas', async () => {
  const { db, context, card } = await setup()
  await recordLiteralHint(db, uid, card, 'session-one', 1)
  await submitLiteralReview(db, uid, context, card, 'La nube pasa.', { ...evidence, highestHint: 1 }, 'good', 'private-review', true)
  const root = admin.collection('users').doc(uid)
  const event = (await root.collection('literalAttempts').doc('private-review').get()).data()
  for (let i = 0; i < 85; i++) await root.collection('literalAttempts').doc(`synthetic-${i}`).set({ ...event, id: `synthetic-${i}` })
  await root.collection('sources').doc(context.source.id).collection('notes').doc('nested').collection('parts').doc('deep').set({ value: 'Dato ficticio' })
  await admin.doc('users/other/sources/other-source').set({ userId: 'other', original: 'Se conserva' })
  await setSourceArchived(db, uid, context.source.id, true, 'archive-three')
  const inventory = await preview(admin, uid, context.source.id)
  assert.ok(inventory.totalDocuments > 85); assert.ok(inventory.documents.some((item) => item.id.includes('parts/deep')))
  const initial = await startDeletion(admin, uid, context.source.id, inventory.fingerprint, 'delete-resumable')
  assert.equal((await startDeletion(admin, uid, context.source.id, inventory.fingerprint, 'delete-resumable')).id, initial.id)
  let job = await stepDeletion(admin, uid, initial.id)
  assert.ok(job.completed > 0); assert.notEqual(job.state, 'completed')
  await assert.rejects(cancelDeletion(admin, uid, job.id), /primer lote/)
  await assertFails(setDoc(doc(db, 'users', uid, 'control', 'maintenance'), { blocked: false }))
  await assert.rejects(createSource(db, uid, { title: 'Bloqueado', kind: 'prose', originalText: 'Un texto.', segmentationMode: 'sentences' }, 'blocked-source'))
  while (job.state !== 'completed') job = await stepDeletion(admin, uid, job.id)
  assert.equal((await stepDeletion(admin, uid, job.id)).state, 'completed')
  for (const kind of ['sources', 'units', 'literalPrograms', 'literalCards', 'literalAttempts', 'literalHints', 'literalExercises']) assert.equal((await root.collection(kind).get()).empty, true, kind)
  assert.equal((await admin.doc('users/other/sources/other-source').get()).exists, true)
  assert.equal((await root.collection('control').doc('maintenance').get()).data().blocked, false)
})
const validPayload = (locusId = 'locus') => ({ ...emptyWorkshop(), mode: 'conceptual', sourceReviewed: true, proposition: 'El movimiento puede representarse mediante una transformación.', foundation: 'Es una idea inicial del recorrido de prueba.', palaceId: 'palace', macroId: 'macro', locusId, agent: 'Una rueda', action: 'Empuja un cubo', symbol: 'Un cubo', distinctiveCue: 'Una rueda de color azul', mapping: 'La rueda representa el movimiento y el cubo su efecto.', prompt: '¿Qué relación representa este lugar?', distinction: 'Es el único cubo azul.', mentalRehearsal: true, sceneDistinguished: true, entranceAttempted: true, entrancePassed: true, meaningConfirmed: true })
test('dependencias cruzadas archivadas y cambios después del preview bloquean sin borrar', async () => {
  const { db, context } = await setup(); await spaces(db)
  await saveWorkshopDraft(db, uid, context.program.unitIds[0], validPayload(), 7, 0)
  const encodingId = await publishEncoding(db, uid, context.program.unitIds[0], 1)
  await createSource(db, uid, { title: 'Referencia externa neutral', kind: 'prose', originalText: 'Otra relación se apoya en la anterior.', segmentationMode: 'sentences' }, 'external')
  const externalUnit = await createUnit(db, uid, 'external', { revisionId: 'r1', startOffset: 0, endOffset: 36, ordinal: 0 })
  await createSpace(db, uid, { kind: 'locus', palaceId: 'palace', macroId: 'macro', name: 'Ventana', cue: 'Ventana cuadrada', ordinal: 1, sensoryCues: [] }, 'locus-two')
  await saveWorkshopDraft(db, uid, externalUnit, { ...validPayload('locus-two'), foundational: false, linkedConceptId: `${encodingId}_concept`, linkExplanation: 'La segunda idea depende de la primera.' }, 7, 0)
  await publishEncoding(db, uid, externalUnit, 1)
  await setSourceArchived(db, uid, 'external', true, 'archive-external')
  await setSourceArchived(db, uid, context.source.id, true, 'archive-four')
  const blocked = await preview(admin, uid, context.source.id)
  assert.ok(blocked.blockers.some((item) => item.kind === 'conceptEdges'))
  assert.ok(blocked.blockers.some((item) => item.kind === 'encodings'))
  assert.ok(blocked.blockers.every((item) => item.sourceId === 'external'))
  await assert.rejects(startDeletion(admin, uid, context.source.id, blocked.fingerprint, 'delete-blocked'), /dependen/)
  assert.equal((await admin.doc(`users/${uid}/sources/${context.source.id}`).get()).exists, true)
  await environment.clearFirestore()
  const freshContext = await setup('source-two')
  await setSourceArchived(freshContext.db, uid, 'source-two', true, 'archive-five')
  const old = await preview(admin, uid, 'source-two')
  await createSource(freshContext.db, uid, { title: 'Cambio neutral', kind: 'prose', originalText: 'Un cambio concurrente.', segmentationMode: 'sentences' }, 'concurrent-source')
  await assert.rejects(startDeletion(admin, uid, 'source-two', old.fingerprint, 'delete-stale'), /cambió/)
  const fresh = await preview(admin, uid, 'source-two')
  const job = await startDeletion(admin, uid, 'source-two', fresh.fingerprint, 'delete-cancel')
  await cancelDeletion(admin, uid, job.id)
  assert.equal((await admin.doc(`users/${uid}/sources/source-two`).get()).exists, true)
})
test('endpoint cerrado por defecto, tokens incorrectos y proyecto ajeno rechazados', async () => {
  let status, body
  const res = { setHeader() {}, status(value) { status = value; return this }, json(value) { body = value; return this } }
  delete process.env.SOLAR_ADMIN_DELETION_ENABLED
  await handler({ method: 'POST', body: {} }, res)
  assert.equal(status, 503); assert.ok(body.error)
  await assert.rejects(authenticate({ headers: {} }, {}, projectId), /Inicia sesión/)
  await assert.rejects(authenticate({ headers: { authorization: 'Bearer test' } }, { verifyIdToken: async () => ({ uid, aud: 'other', iss: 'other' }) }, projectId), /válida/)
  assert.equal(await authenticate({ headers: { authorization: 'Bearer test' } }, { verifyIdToken: async () => ({ uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}` }) }, projectId), uid)
  await assert.rejects(preview(admin, 'other', 'source-one'), /No se encontró/)
})
test('mantenimiento y lecturas literales mantienen aislamiento de otra cuenta y deniegan borrado directo', async () => {
  const { db, card } = await setup()
  const other = environment.authenticatedContext('other').firestore()
  for (const kind of ['literalPrograms', 'literalExercises', 'literalCards', 'literalAttempts', 'literalBindings', 'literalHints', 'deletionJobs', 'control']) {
    await assertFails(getDocs(collection(other, 'users', uid, kind)))
    await assertFails(setDoc(doc(other, 'users', uid, kind, 'forged'), { userId: uid }))
  }
  const cards = await getDocs(query(collection(db, 'users', uid, 'literalCards'), where('sourceId', '==', 'source-one')))
  assert.equal(cards.docs[0].id, card.id)
})

test('archivo: una petición repetida después de restaurar no vuelve a archivar', async () => {
  const { db, context } = await setup()
  await setSourceArchived(db, uid, context.source.id, true, 'stable-archive')
  await setSourceArchived(db, uid, context.source.id, false, 'stable-restore')
  await setSourceArchived(db, uid, context.source.id, true, 'stable-archive')
  assert.equal((await getDocFromServer(privateRef(db, uid, 'sources', context.source.id))).data().lifecycle, 'active')
})
test('manifiesto interrumpido, concesión vencida y dos trabajadores preservan checkpoints', async () => {
  const { db, context } = await setup(); await setSourceArchived(db, uid, context.source.id, true, 'interrupt-archive')
  const data = await preview(admin, uid, context.source.id); const root = admin.collection('users').doc(uid); const id = 'interrupted-preparation'
  await root.collection('control').doc('maintenance').set({ userId: uid, blocked: true, jobId: id })
  await root.collection('deletionJobs').doc(id).set({ id, userId: uid, sourceId: context.source.id, fingerprint: data.fingerprint, state: 'preparing', cursor: 0, completed: 0, total: 0, totalPages: 0, lease: null, version: 1 })
  const prepared = await stepDeletion(admin, uid, id)
  assert.equal(prepared.state, 'ready')
  const results = await Promise.allSettled([stepDeletion(admin, uid, id), stepDeletion(admin, uid, id)])
  assert.ok(results.some((result) => result.status === 'fulfilled'))
  let job = (await root.collection('deletionJobs').doc(id).get()).data()
  while (job.state !== 'completed') job = await stepDeletion(admin, uid, id)
  assert.equal(job.completed, job.total)
  // Simulate termination after the last atomic checkpoint and before finalization.
  await root.collection('deletionJobs').doc(id).update({ state: 'ready' })
  await root.collection('control').doc('maintenance').set({ userId: uid, blocked: true, jobId: id })
  assert.equal((await stepDeletion(admin, uid, id)).state, 'completed')
  assert.equal((await root.collection('control').doc('maintenance').get()).data().blocked, false)
})
test('ocupación cambiada y contratos desconocidos bloquean una eliminación sin liberar loci ajenos', async () => {
  const { db, context } = await setup(); await spaces(db)
  await associateLiteralLocus(db, uid, context, { start: 0, end: 1, scope: 'segment' }, 'locus')
  await setSourceArchived(db, uid, context.source.id, true, 'changed-locus-archive')
  const root = admin.collection('users').doc(uid)
  await root.collection('unknownFutureRecords').doc('unrecognized').set({ userId: uid })
  await assert.rejects(preview(admin, uid, context.source.id), /no reconocida/)
  await root.collection('unknownFutureRecords').doc('unrecognized').delete()
  const data = await preview(admin, uid, context.source.id)
  const job = await startDeletion(admin, uid, context.source.id, data.fingerprint, 'changed-locus-job')
  await root.collection('microStations').doc('locus').update({ version: 99, activeBinding: { kind: 'literal', id: 'different-binding' } })
  await assert.rejects(stepDeletion(admin, uid, job.id), /ocupación/)
  assert.equal((await root.collection('sources').doc(context.source.id).get()).exists, true)
  assert.equal((await root.collection('microStations').doc('locus').get()).data().activeBinding.id, 'different-binding')
  assert.equal((await root.collection('control').doc('maintenance').get()).data().blocked, true)
  await cancelDeletion(admin, uid, job.id)
})

test('publicación conceptual compartida conserva tarjetas v1 y archivar revoca también su repaso', async () => {
  const { db, context } = await setup(); await spaces(db)
  await saveWorkshopDraft(db, uid, context.program.unitIds[0], validPayload(), 7, 0)
  const id = await publishEncoding(db, uid, context.program.unitIds[0], 1)
  const cards = (await getDocs(collection(db, 'users', uid, 'cards'))).docs.map((doc) => doc.data())
  assert.deepEqual(cards.map((card) => card.target).sort(), ['concept', 'explanation'])
  const { readReviewContext, submitReview } = await import('../../src/data/firestore/cognitiveRepository.js')
  const { newRecall, recallReducer } = await import('@icarus/domain/review')
  const before = await readReviewContext(db, uid, `${id}_concept`)
  const failed = recallReducer(recallReducer(newRecall('concept'), { type: 'FAIL' }), { type: 'NEXT' })
  await setSourceArchived(db, uid, context.source.id, true, 'concept-archive')
  await assert.rejects(readReviewContext(db, uid, `${id}_concept`), /archivado/)
  await assert.rejects(submitReview(db, uid, `${id}_concept`, before.card.version, failed, 'again', 'blocked-concept-review'), /archivado/)
  assert.deepEqual((await getDocs(collection(db, 'users', uid, 'cards'))).docs.map((doc) => doc.data()), cards)
  assert.equal((await getDocs(collection(db, 'users', uid, 'reviewEvents'))).empty, true)
})

test('subcolecciones sin raíz y conceptos primarios históricos sin encodingId no quedan huérfanos', async () => {
  const { db, context } = await setup(); const root = admin.collection('users').doc(uid)
  await setSourceArchived(db, uid, context.source.id, true, 'orphans-archive')
  await root.collection('units').doc('orphan-root').collection('revisions').doc('v1').set({ sourceId: context.source.id })
  await assert.rejects(preview(admin, uid, context.source.id), /padre ausente/)
  await root.collection('units').doc('orphan-root').collection('revisions').doc('v1').delete()
  // A compatible imported primary concept may lack an encodingId.
  const unitRef = root.collection('units').doc(context.program.unitIds[0]); const unit = (await unitRef.get()).data()
  await root.collection('concepts').doc('imported-primary').set({ id: 'imported-primary', userId: uid, schemaVersion: 1, version: 1, createdAt: unit.createdAt, canonicalProposition: 'Una idea de prueba importada.', kind: 'explanation', terms: [], premises: [], conclusion: '', whyItFollows: '', status: 'reviewed' })
  await unitRef.update({ primaryConceptId: 'imported-primary' })
  const concept = (await root.collection('concepts').doc('imported-primary').get()).data()
  await root.collection('concepts').doc('unrelated-concept').set({ ...concept, id: 'unrelated-concept', canonicalProposition: 'Otra idea que debe conservarse.' })
  await root.collection('conceptEdges').doc('imported-edge').set({ id: 'imported-edge', userId: uid, schemaVersion: 1, version: 1, createdAt: unit.createdAt, fromConceptId: 'imported-primary', toConceptId: 'unrelated-concept', type: 'contrasts', explanation: 'La primera idea contrasta con otra independiente.', evidenceUnitIds: [unit.id] })
  const data = await preview(admin, uid, context.source.id)
  assert.equal(data.counts.concepts, 1); assert.equal(data.counts.conceptEdges, 1)
  let job = await startDeletion(admin, uid, context.source.id, data.fingerprint, 'delete-imported-concept')
  while (job.state !== 'completed') job = await stepDeletion(admin, uid, job.id)
  assert.equal((await root.collection('concepts').doc('imported-primary').get()).exists, false)
  assert.equal((await root.collection('conceptEdges').doc('imported-edge').get()).exists, false)
  assert.equal((await root.collection('concepts').doc('unrelated-concept').get()).exists, true)
})

test('una concesión expirada no desbloquea la cuenta; cancelar explícitamente invalida al trabajador antiguo', async () => {
  const { db, context } = await setup(); await setSourceArchived(db, uid, context.source.id, true, 'expired-archive')
  const root = admin.collection('users').doc(uid); const id = 'expired-preparer'; const data = await preview(admin, uid, context.source.id)
  await root.collection('control').doc('maintenance').set({ userId: uid, blocked: true, jobId: id })
  await root.collection('deletionJobs').doc(id).set({ id, userId: uid, sourceId: context.source.id, fingerprint: data.fingerprint, state: 'preparing', cursor: 0, completed: 0, total: 0, totalPages: 0, lease: { id: 'old-worker', until: new Date(Date.now() - 1000) }, version: 1 })
  await assert.rejects(setSourceArchived(db, uid, context.source.id, false, 'blocked-expired'), /eliminación/)
  await cancelDeletion(admin, uid, id)
  const cancelled = (await root.collection('deletionJobs').doc(id).get()).data()
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.lease, null)
  assert.equal((await stepDeletion(admin, uid, id)).state, 'cancelled')
  assert.equal((await root.collection('sources').doc(context.source.id).get()).exists, true)
  await setSourceArchived(db, uid, context.source.id, false, 'restored-expired')
})

test('una eliminación parcial no permite recrear un concepto usando una codificación histórica todavía presente', async () => {
  const { db, context } = await setup(); await spaces(db)
  await saveWorkshopDraft(db, uid, context.program.unitIds[0], validPayload(), 7, 0)
  const id = await publishEncoding(db, uid, context.program.unitIds[0], 1)
  const conceptRef = privateRef(db, uid, 'concepts', `${id}_concept`)
  const original = (await getDocFromServer(conceptRef)).data()
  await setSourceArchived(db, uid, context.source.id, true, 'partial-archive')
  const root = admin.collection('users').doc(uid)
  await root.collection('control').doc('maintenance').set({ userId: uid, blocked: true, jobId: 'partial-test' })
  await root.collection('concepts').doc(original.id).delete()
  await assertFails(setDoc(conceptRef, { ...original, createdAt: serverTimestamp() }))
  assert.equal((await root.collection('concepts').doc(original.id).get()).exists, false)
})
