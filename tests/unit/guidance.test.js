import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HELP, helpFor, KIND_HELP, MODE_HELP, RELATION_HELP, STEP_GUIDES } from '../../src/features/guidance/catalog.js'
import { DEFAULT_GUIDANCE, loadGuidancePreference, parseGuidancePreference, preferenceKey, saveGuidancePreference } from '../../src/features/guidance/preferences.js'
import { emptyWorkshop, workshopPayloadSchema } from '@icarus/domain/encoding'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('guía: preferencia versionada por cuenta, persistencia e introducción independiente del nivel', () => {
  const storage = memoryStorage()
  const value = { ...DEFAULT_GUIDANCE, mode: 'normal', introduction: 'completed' }
  assert.equal(saveGuidancePreference('a', value, storage), true)
  assert.deepEqual(loadGuidancePreference('a', storage), { preference: value, available: true })
  assert.deepEqual(loadGuidancePreference('b', storage).preference, DEFAULT_GUIDANCE)
  assert.notEqual(preferenceKey('a:b'), preferenceKey('a/b'))
  const skipped = { ...value, introduction: 'skipped' }
  assert.equal(parseGuidancePreference(JSON.stringify(skipped)).mode, 'normal')
  assert.equal(parseGuidancePreference(JSON.stringify(skipped)).introduction, 'skipped')
})

test('guía: preferencias ausentes, corruptas o de versiones desconocidas no bloquean el aprendizaje', () => {
  for (const value of [null, '', '{', 'null', '[]', '{"version":9,"mode":"normal","introduction":"completed"}', '{"version":1,"mode":"invalid","introduction":"new"}']) {
    assert.deepEqual(parseGuidancePreference(value), DEFAULT_GUIDANCE)
  }
  const parsed = parseGuidancePreference(JSON.stringify({ ...DEFAULT_GUIDANCE, payload: { secret: 'no-copy' } }))
  assert.deepEqual(Object.keys(parsed).sort(), ['introduction', 'mode', 'version'])
})

test('guía: almacenamiento bloqueado o cuota agotada produce un resultado explícito y recuperable', () => {
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
  assert.deepEqual(loadGuidancePreference('a', blocked), { preference: { ...DEFAULT_GUIDANCE }, available: false })
  assert.equal(saveGuidancePreference('a', DEFAULT_GUIDANCE, blocked), false)
  const full = { getItem() { return null }, setItem() { throw new Error('quota') } }
  assert.equal(saveGuidancePreference('a', DEFAULT_GUIDANCE, full), false)
  assert.equal(saveGuidancePreference('a', DEFAULT_GUIDANCE, memoryStorage()), true)
})

test('guía: cada campo visible del contrato del Taller tiene seis explicaciones completas', () => {
  const fields = Object.keys(emptyWorkshop()).filter((key) => key !== 'entranceAttempted') // Flag interno, no es un campo editable.
  for (const field of fields) {
    const help = helpFor(`workshop.${field}`)
    for (const key of ['title', 'meaning', 'purpose', 'instruction', 'example', 'when', 'empty']) assert.ok(typeof help[key] === 'string' && help[key].trim(), `${field}: falta ${key}`)
  }
  for (const [topic, help] of Object.entries(HELP)) {
    for (const key of ['meaning', 'purpose', 'instruction', 'example', 'when', 'empty']) assert.ok(help[key]?.trim(), `${topic}: falta ${key}`)
  }
  assert.equal(STEP_GUIDES.length, 8)
  assert.throws(() => helpFor('unknown-field'), /Ayuda no registrada/)
})

test('guía: todas las opciones condicionales tienen orientación, dirección y consecuencias concretas', () => {
  assert.deepEqual(Object.keys(RELATION_HELP).sort(), workshopPayloadSchema.shape.edgeType.options.toSorted())
  assert.deepEqual(Object.keys(KIND_HELP).sort(), workshopPayloadSchema.shape.conceptKind.options.toSorted())
  assert.deepEqual(Object.keys(MODE_HELP).sort(), workshopPayloadSchema.shape.mode.options.toSorted())
  assert.match(helpFor('workshop.mode', { mode: 'literal' }).selection, /obligatorio completar todo el Taller/)
  assert.match(helpFor('workshop.conceptKind', { conceptKind: 'argument' }).selection, /tres campos obligatorios/)
  assert.match(helpFor('workshop.conceptKind', { conceptKind: 'definition' }).example, /triángulo/)
  assert.match(helpFor('workshop.conceptKind', { conceptKind: 'sequence' }).example, /orden/)
  assert.match(helpFor('workshop.mode', { mode: 'dual' }).example, /agendas independientes/)
  assert.match(helpFor('workshop.foundational', { foundational: false }).selection, /concepto anterior revisado/)
  assert.match(helpFor('workshop.foundational', { foundational: true }).selection, /inicia una rama/)
  for (const edgeType of Object.keys(RELATION_HELP)) {
    const help = helpFor('workshop.edgeType', { edgeType })
    assert.match(help.selection, /nueva → idea anterior/)
    assert.ok(help.example)
  }
})

test('guía: la ayuda no interpola respuestas privadas ni modifica el borrador o los gates', () => {
  const payload = { ...emptyWorkshop(), proposition: 'RESPUESTA_PRIVADA', agent: 'AGENTE_PRIVADO', mode: 'literal', foundational: false }
  const before = JSON.stringify(payload)
  for (const topic of Object.keys(HELP)) {
    const help = JSON.stringify(helpFor(topic, payload))
    assert.ok(!help.includes('RESPUESTA_PRIVADA') && !help.includes('AGENTE_PRIVADO'), topic)
  }
  assert.equal(JSON.stringify(payload), before)
})
