import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STRICT_PROFILE, compareLiteral, segmentLiteral, exercisePlan, normalizeLiteral, literalRatingCap, originalOffsetFromTextarea } from '@icarus/domain/literal'

const profile = { ...STRICT_PROFILE, whitespace: 'collapse' }
test('literal: igualdad, desinencias distintas, omisión, inserción y sustitución', () => {
  assert.equal(compareLiteral('rosa clara', 'rosa clara', profile).conforms, true)
  const substitution = compareLiteral('rosa clara', 'rosae clara', profile)
  assert.equal(substitution.conforms, false); assert.equal(substitution.operations[0].type, 'substitution')
  assert.equal(compareLiteral('uno dos tres', 'uno tres', profile).operations.some((op) => op.type === 'omission'), true)
  assert.equal(compareLiteral('uno tres', 'uno dos tres', profile).operations.some((op) => op.type === 'insertion'), true)
})
test('literal: orden y palabras repetidas no inventan una alineación inequívoca', () => {
  assert.equal(compareLiteral('alfa beta', 'beta alfa', profile).orderChanged, true)
  const repeated = compareLiteral('uno uno dos', 'uno dos', profile)
  assert.equal(repeated.conforms, false); assert.equal(repeated.ambiguous, true)
})
test('literal: perfiles explícitos, Unicode y coincidencia léxica separada de tipografía', () => {
  const result = compareLiteral('Árbol, claro.', 'árbol claro', profile)
  assert.equal(result.conforms, false); assert.equal(result.rawExact, false)
  const loose = { ...profile, caseSensitive: false, punctuation: false }
  assert.equal(compareLiteral('Árbol, claro.', 'árbol claro', loose).conforms, true)
  assert.equal(compareLiteral('Árbol', 'Arbol', profile).conforms, false)
  assert.equal(compareLiteral('Árbol', 'Arbol', { ...profile, diacritics: false }).conforms, true)
  assert.equal(compareLiteral('iuvat', 'juuat', profile).conforms, false)
  assert.equal(compareLiteral('iuvat', 'juuat', { ...profile, latinIJ: true, latinUV: true }).conforms, true)
  assert.equal(normalizeLiteral('a\r\nb', STRICT_PROFILE), 'a\r\nb')
  assert.equal(compareLiteral('café', 'cafe\u0301', profile).rawExact, false)
  assert.equal(compareLiteral('café', 'cafe\u0301', profile).conforms, true)
})
test('literal: distintos alfabetos, CJK y puntuación de oración', () => {
  for (const value of ['明日は晴れ。今日は雨。', 'Светлый день.', 'مرحبا بالعالم', 'हवा चलती है।', '🌳 árbol']) assert.equal(compareLiteral(value, value, profile).conforms, true)
  assert.equal(segmentLiteral('今日は雨。明日は晴れ。', 'sentences', [], 'ja').length, 2)
})
test('literal: cortes conservan absolutamente todos los separadores y caracteres', () => {
  const original = '  Alfa 🌞.\r\nBeta!\r\n\r\nGamma.  '
  for (const mode of ['verses', 'versicles', 'stanzas', 'paragraphs', 'sentences', 'manual']) {
    const segments = segmentLiteral(original, mode, mode === 'manual' ? [4, 15] : [])
    assert.equal(segments.map((segment) => segment.text).join(''), original)
    assert.equal(segments[0].startOffset, 0); assert.equal(segments.at(-1).endOffset, original.length)
    segments.forEach((segment) => assert.equal(original.slice(segment.startOffset, segment.endOffset), segment.text))
  }
  assert.throws(() => segmentLiteral('A🌞B', 'manual', [2]), /Unicode/)
  assert.throws(() => segmentLiteral('abc', 'manual', [4]))
})
test('literal: recursos limitados y obra extensa sin truncar ni acreditar una comparación parcial', () => {
  const text = 'palabra '.repeat(7000)
  assert.equal(compareLiteral(text, text).complete, true)
  assert.equal(compareLiteral('a b c d', 'e f g h', profile, { maxCells: 2 }).complete, false)
  assert.equal(literalRatingCap({ complete: false, conforms: true, highestHint: 0 }), 'again')
})
test('literal: progresión acumulativa, comienzos intermedios y exámenes independientes', () => {
  assert.deepEqual(exercisePlan(3).map(({ start, end }) => [start, end]), [[0, 1], [1, 2], [0, 2], [2, 3], [0, 3], [1, 3]])
  assert.deepEqual(exercisePlan(5, { kind: 'segments', start: 3 }).map((exercise) => exercise.start), [3, 4])
  assert.equal(exercisePlan(5, { kind: 'whole', start: 2 })[0].start, 0)
  assert.equal(exercisePlan(8, { maxExercises: 3 }).length, 3)
  assert.throws(() => exercisePlan(2, { start: 2 }))
})
test('literal: notas dependen de autonomía; oral es manual y una reparación no borra el fallo', () => {
  const autonomous = { complete: true, conforms: true, highestHint: 0, revealed: false, verification: 'automatic' }
  assert.equal(literalRatingCap(autonomous), 'easy')
  assert.equal(literalRatingCap({ ...autonomous, highestHint: 1 }), 'good')
  assert.equal(literalRatingCap({ ...autonomous, highestHint: 2 }), 'hard')
  assert.equal(literalRatingCap({ ...autonomous, revealed: true }), 'again')
  assert.equal(literalRatingCap({ ...autonomous, retry: true }), 'again')
  assert.equal(literalRatingCap({ ...autonomous, verification: 'manual', manualCorrect: true }), 'good')
  assert.equal(literalRatingCap({ ...autonomous, conforms: false }), 'again')
})

test('literal: el cursor del textarea normaliza CRLF, pero los cortes conservan offsets del original', () => { assert.equal(originalOffsetFromTextarea('a\r\nb', 2), 3); assert.equal(originalOffsetFromTextarea('a\r\nb', 3), 4) })
test('literal: un orden alterado junto con otras diferencias se señala sin atribuir intención', () => {
  assert.equal(compareLiteral('alfa beta gamma delta', 'beta alfa gamma nuevo', profile).possibleMovement, true)
})
