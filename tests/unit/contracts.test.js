import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROFILE, getIcarusCapabilities } from '@icarus/domain/flags'
import { conceptSchema, locusSchema, passesEncodingGate, profileSchema, unitSchema } from '@icarus/domain/schemas'
import { locateLegacyFragments, proposeSegments, assertExactSourceSlice } from '@icarus/domain/segmentation'
import { toTimestamp } from '@icarus/domain/codec'

test('bandera: default clásico y activación de estudio bloqueada durante fundamentos', () => {
  assert.equal(DEFAULT_PROFILE.icarusEnabled, false)
  assert.equal(getIcarusCapabilities().preparationAvailable, false)
  assert.equal(getIcarusCapabilities({ icarusEnabled: true }, true).studyAvailable, false)
  assert.equal(getIcarusCapabilities({}, true).productionMigrationAvailable, false)
  assert.equal(profileSchema.safeParse({ ...DEFAULT_PROFILE, unknown: true }).success, false)
})

test('segmentación: conserva fuente y offsets UTF-16, incluso con emoji/CRLF', () => {
  const source = '  ☀️ Una idea.\r\n\r\nOtra idea.  '
  const segments = proposeSegments(source)
  assert.equal(segments.length, 2)
  for (const segment of segments) assertExactSourceSlice({ originalText: source }, { ...segment, traceStatus: 'resolved' })
  assert.equal(segments[0].startOffset, 2)
  assert.equal(source, '  ☀️ Una idea.\r\n\r\nOtra idea.  ')
})

test('poesía: estrofas y versos tienen cortes propios sin reescribir saltos de línea', () => {
  const poem = 'Uno\r\nDos\r\n\r\nTres\r\nCuatro'
  assert.equal(proposeSegments(poem, 'verses').length, 4)
  const stanzas = proposeSegments(poem, 'stanzas')
  assert.equal(stanzas.length, 2)
  assert.equal(stanzas[0].text, 'Uno\r\nDos')
})

test('fragmentos repetidos se ubican secuencialmente; no se inventa una posición', () => {
  const locations = locateLegacyFragments('Eco. Eco.', [{ text: 'Eco.' }, { text: 'Eco.' }, { text: 'Ausente' }])
  assert.equal(locations[0].startOffset, 0)
  assert.equal(locations[1].startOffset, 5)
  assert.equal(locations[2].startOffset, null)
  assert.equal(locations[2].traceStatus, 'unresolved')
})

test('quality gate: intentar y fallar no permite publicar', () => {
  const gate = { sourceReviewed: true, objectiveSelected: true, foundational: true, foundationJustification: 'Concepto inicial del dominio.', linkedConceptId: null, sceneDistinguished: true, initialRecallAttempted: true, entranceExamPassed: true, userConfirmedMeaning: true }
  assert.equal(passesEncodingGate(gate), true)
  assert.equal(passesEncodingGate({ ...gate, entranceExamPassed: false }), false)
  assert.equal(passesEncodingGate({ ...gate, foundationJustification: ' ' }), false)
  assert.equal(passesEncodingGate({ ...gate, sceneDistinguished: false }), false)
})

test('locus: ocupación y asociación activa deben coincidir', () => {
  const locus = { id: 'locus', userId: 'user', schemaVersion: 1, version: 1, createdAt: toTimestamp(0), palaceId: 'palace', macroId: 'macro', name: 'Atril', anchorDescription: 'Madera tallada ante una ventana.', sensoryCues: ['luz'], ordinal: 0, state: 'free', activeEncodingId: null, usageCountLifetime: 0 }
  assert.equal(locusSchema.safeParse(locus).success, true)
  assert.equal(locusSchema.safeParse({ ...locus, state: 'occupied' }).success, false)
  assert.equal(locusSchema.safeParse({ ...locus, state: 'occupied', activeEncodingId: 'encoding' }).success, true)
})

test('contrato conceptual: exige estructura para argumento revisado, no para interpretación poética', () => {
  const concept = { id: 'concept', userId: 'user', schemaVersion: 1, version: 1, createdAt: toTimestamp(0), canonicalProposition: 'El poema contrapone tiempo y permanencia.', kind: 'interpretation', terms: [], premises: [], conclusion: '', whyItFollows: '', status: 'reviewed' }
  assert.equal(conceptSchema.safeParse(concept).success, true)
  assert.equal(conceptSchema.safeParse({ ...concept, kind: 'argument' }).success, false)
})

test('unidad lista no puede omitir concepto ni origen verificable', () => {
  const unit = { id: 'unit', userId: 'user', schemaVersion: 1, version: 1, createdAt: toTimestamp(0), sourceId: 'source', sourceRevisionId: 'revision', unitRevision: 1, ordinal: 0, text: 'Texto', status: 'needs_concept', startOffset: null, endOffset: null, traceStatus: 'unresolved', targetMode: null, targets: [], primaryConceptId: null, legacyRef: null }
  assert.equal(unitSchema.safeParse(unit).success, true)
  assert.equal(unitSchema.safeParse({ ...unit, status: 'ready' }).success, false)
})
