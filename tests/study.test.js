import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateReview, DAY_MS, isDue, normalizeChunks, normalizeProgress, previewText, splitText } from '../src/lib.js'

test('poesía: conserva versos y descarta líneas vacías', () => {
  assert.deepEqual(splitText('  Primer verso\r\n\nSegundo verso  \n ', 'poesia'), [
    { id: 'chunk_0', text: 'Primer verso', order: 0 }, { id: 'chunk_1', text: 'Segundo verso', order: 1 },
  ])
})
test('prosa: segmenta puntos, interrogación, exclamación y saltos de línea', () => {
  assert.deepEqual(splitText('Una oración. ¿Otra? ¡Sí!\nÚltima', 'prosa').map((chunk) => chunk.text), ['Una oración.', '¿Otra?', '¡Sí!', 'Última'])
})
test('normalización: resiste datos vacíos, corruptos y IDs duplicados', () => {
  assert.deepEqual(splitText(null, 'poesia'), [])
  assert.deepEqual(normalizeChunks({}), [])
  assert.deepEqual(normalizeChunks([null, { id: 'a/b', text: 'x' }, { id: 'chunk_0', text: ' A ', order: 1 }, { id: 'chunk_0', text: 'B' }]), [{ id: 'chunk_0', text: 'A', order: 1 }])
  assert.deepEqual(normalizeProgress({ interval: NaN, ease: Infinity, nextReview: -1 }), { interval: 0, ease: 2.5, nextReview: 0 })
})
test('Ícaro: las cuatro calificaciones producen los intervalos iniciales exigidos', () => {
  const now = 1700000000000
  assert.deepEqual(calculateReview(undefined, 1, now), { interval: 0, ease: 2.3, nextReview: now })
  assert.deepEqual(calculateReview(undefined, 2, now), { interval: 1, ease: 2.35, nextReview: now + DAY_MS })
  assert.deepEqual(calculateReview(undefined, 3, now), { interval: 1, ease: 2.5, nextReview: now + DAY_MS })
  assert.deepEqual(calculateReview(undefined, 4, now), { interval: 4, ease: 2.65, nextReview: now + 4 * DAY_MS })
})
test('Ícaro: adapta intervalos existentes y respeta ease mínimo', () => {
  const previous = { interval: 10, ease: 2.5, nextReview: 0 }
  assert.equal(calculateReview(previous, 2, 0).interval, 12)
  assert.equal(calculateReview(previous, 3, 0).interval, 25)
  assert.equal(calculateReview(previous, 4, 0).interval, 33)
  assert.equal(calculateReview({ ease: 1.3 }, 1, 0).ease, 1.3)
  assert.equal(calculateReview({ ease: 1.3 }, 2, 0).ease, 1.3)
  assert.throws(() => calculateReview({}, 5))
})
test('pendientes: incluye nuevos, límites exactos y Repetir inmediatamente', () => {
  assert.equal(isDue(undefined, 10), true)
  assert.equal(isDue({ nextReview: 10 }, 10), true)
  assert.equal(isDue({ nextReview: 11 }, 10), false)
  assert.equal(isDue(calculateReview({}, 1, 10), 10), true)
})
test('preview: limita a 120 caracteres sin cortar pares Unicode', () => {
  assert.equal(Array.from(previewText('☀'.repeat(121))).length, 121)
  assert.equal(previewText('Texto breve'), 'Texto breve')
  assert.equal(previewText(undefined), '')
})
