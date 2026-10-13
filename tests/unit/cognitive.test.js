import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyWorkshop, targetsForMode, workshopIssues } from '@icarus/domain/encoding'
import { literalDiff, maximumRating, newRecall, recallReducer, validateRating } from '@icarus/domain/review'
import { newScheduler, scheduleReview, unpackScheduler } from '@icarus/domain/scheduler'

function recovered(target = 'concept') {
  let context = recallReducer(newRecall(target), { type: 'NEXT' })
  while (context.phase !== 'REVEAL') context = recallReducer(context, { type: 'NEXT', attempt: 'Respuesta recuperada antes de mostrar la fuente.' })
  for (const key of ['mainIdea', 'explanation', 'exact', 'noCriticalError']) context = recallReducer(context, { type: 'CHECK', key, value: true })
  return recallReducer(context, { type: 'NEXT' })
}
test('objetivos: comprensión/explicación y recitación tienen tarjetas independientes', () => {
  assert.deepEqual(targetsForMode('conceptual'), ['concept', 'explanation'])
  assert.deepEqual(targetsForMode('literal'), ['verbatim'])
  assert.deepEqual(targetsForMode('dual'), ['concept', 'explanation', 'verbatim'])
  assert.equal(emptyWorkshop('poetry').mode, 'dual')
  assert.throws(() => targetsForMode('unknown'))
})
test('Taller: una investigación pendiente, copia no justificada o examen fallido bloquean publicación', () => {
  const p = { ...emptyWorkshop(), sourceReviewed: true, proposition: 'Original', foundation: 'Idea inicial.', palaceId: 'p', macroId: 'm', locusId: 'l', agent: 'Monje', action: 'Salta', symbol: 'Atril', distinctiveCue: 'Rojo', mapping: 'Un movimiento representa la tesis.', prompt: '¿Qué relación?', distinction: 'Sin vecinos similares', mentalRehearsal: true, sceneDistinguished: true, entranceAttempted: true, entrancePassed: true, meaningConfirmed: true }
  assert.equal(workshopIssues(p, { text: 'Original' }).length, 1)
  assert.equal(workshopIssues({ ...p, quoteNecessary: true }, { text: 'Original' }).length, 0)
  assert.ok(workshopIssues({ ...p, proposition: 'Paráfrasis', needsResearch: true }, { text: 'Original' }).length)
  assert.ok(workshopIssues({ ...p, proposition: 'Paráfrasis', entrancePassed: false }, { text: 'Original' }).length)
})
test('recuperación: no hay transición de orientación a nota ni revelación por avance vacío', () => {
  const initial = newRecall('concept')
  assert.equal(recallReducer(initial, { type: 'COMMIT', rating: 'good' }).phase, 'ORIENT')
  const scene = recallReducer(initial, { type: 'NEXT' })
  assert.equal(recallReducer(scene, { type: 'NEXT', attempt: ' ' }).phase, 'SCENE_RECALL')
  assert.equal(recallReducer(scene, { type: 'HINT', attempt: '' }).highestHint, 0)
  assert.throws(() => validateRating(initial, 'easy'))
})
test('topes H0–H3 y fracaso auténtico: Hard no sirve como nota de olvido', () => {
  const context = recovered()
  assert.deepEqual([0, 1, 2, 3].map((highestHint) => maximumRating({ ...context, highestHint })), ['easy', 'good', 'hard', 'again'])
  assert.equal(maximumRating({ ...context, failed: true }), 'again')
  assert.equal(maximumRating({ ...context, checklist: { ...context.checklist, noCriticalError: false } }), 'again')
  assert.throws(() => validateRating({ ...context, highestHint: 2 }, 'good'))
  assert.equal(validateRating({ ...context, highestHint: 2 }, 'hard'), 'hard')
})
test('No recuerdo permite revelar, pero nunca convertir esa revelación en éxito', () => {
  let context = recallReducer(newRecall('explanation'), { type: 'FAIL' })
  for (const key of ['mainIdea', 'explanation', 'noCriticalError']) context = recallReducer(context, { type: 'CHECK', key, value: true })
  context = recallReducer(context, { type: 'NEXT' })
  assert.equal(maximumRating(context), 'again')
  assert.throws(() => validateRating(context, 'hard'))
})
test('literalidad: comparación exacta preserva signos, saltos, espacios y Unicode', () => {
  assert.equal(literalDiff('🌞\nVerso.', '🌞\nVerso.').exact, true)
  assert.equal(literalDiff('Verso.', 'verso.').exact, false)
  assert.equal(literalDiff('Dos\r\nversos', 'Dos\nversos').exact, false)
  assert.equal(literalDiff('🌞a', '🌞b').firstDifference, 1)
  assert.equal(maximumRating(recovered('verbatim')), 'easy')
})
test('FSRS: serialización completa sin arrays anidados en Firestore; codec incompatible se rechaza', () => {
  const now = 1700000000000
  const initial = newScheduler(now)
  assert.equal(typeof initial.snapshot, 'string')
  const restored = unpackScheduler(initial)
  assert.equal(restored.card.due.getTime(), now)
  assert.ok(Array.isArray(restored.parameters.w))
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    const next = scheduleReview(initial, rating, now)
    assert.equal(unpackScheduler(next.scheduler).card.reps, 1)
    assert.equal(unpackScheduler(next.scheduler).card.last_review.getTime(), now)
    assert.ok(next.dueAt.seconds * 1000 >= now)
  }
  assert.equal(unpackScheduler(initial).card.reps, 0)
  assert.throws(() => unpackScheduler({ ...initial, packageVersion: '0.0.0' }))
  assert.throws(() => unpackScheduler({ ...initial, snapshot: '{}' }))
})
