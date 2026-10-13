import { z } from 'zod'
import { conceptSchema, encodingSchema, idSchema, sceneSchema, validateUnitAgainstRevision } from './schemas.js'
import { toTimestamp } from './codec.js'
import { newScheduler } from './scheduler.js'

export const WORKSHOP_STEPS = ['Manuscrito', 'Lectura y objetivo', 'Destilación', 'Enlaces', 'Arquitectura', 'Imagen', 'Correspondencia', 'Examen de entrada']
const field = z.string().max(4000).trim()
export const workshopPayloadSchema = z.object({
  sourceReviewed: z.boolean(), mode: z.enum(['conceptual', 'literal', 'dual']),
  conceptKind: z.enum(['argument', 'definition', 'explanation', 'interpretation', 'sequence']),
  unknownTerms: field, proposition: field, terms: field, premises: field, conclusion: field, why: field,
  quoteNecessary: z.boolean(), needsResearch: z.boolean(),
  foundational: z.boolean(), foundation: field, linkedConceptId: idSchema.nullable(),
  edgeType: z.enum(['causes', 'implies', 'contrasts', 'defines', 'example_of', 'depends_on', 'argument_order']), linkExplanation: field,
  palaceId: idSchema.nullable(), macroId: idSchema.nullable(), locusId: idSchema.nullable(),
  agent: field, action: field, symbol: field, distinctiveCue: field, sensoryDetails: field, mapping: field,
  prompt: field, distinction: field, mentalRehearsal: z.boolean(), sceneDistinguished: z.boolean(),
  entranceAttempted: z.boolean(), entrancePassed: z.boolean(), meaningConfirmed: z.boolean(),
}).strict()
export function emptyWorkshop(kind = 'prose') {
  return workshopPayloadSchema.parse({ sourceReviewed: false, mode: kind === 'poetry' ? 'dual' : 'conceptual', conceptKind: kind === 'poetry' ? 'interpretation' : 'explanation', unknownTerms: '', proposition: '', terms: '', premises: '', conclusion: '', why: '', quoteNecessary: false, needsResearch: false, foundational: true, foundation: '', linkedConceptId: null, edgeType: 'depends_on', linkExplanation: '', palaceId: null, macroId: null, locusId: null, agent: '', action: '', symbol: '', distinctiveCue: '', sensoryDetails: '', mapping: '', prompt: '', distinction: '', mentalRehearsal: false, sceneDistinguished: false, entranceAttempted: false, entrancePassed: false, meaningConfirmed: false })
}
export function targetsForMode(mode) {
  if (!['conceptual', 'literal', 'dual'].includes(mode)) throw new TypeError('Objetivo de aprendizaje no válido.')
  return mode === 'literal' ? ['verbatim'] : mode === 'dual' ? ['concept', 'explanation', 'verbatim'] : ['concept', 'explanation']
}
export const lines = (value) => typeof value === 'string' ? value.split('\n').map((entry) => entry.trim()).filter(Boolean) : []

export function workshopIssues(input, unit, throughStep = 7) {
  const result = workshopPayloadSchema.safeParse(input)
  if (!result.success) return ['El borrador contiene campos no válidos.']
  const p = result.data
  const errors = []
  if (!p.sourceReviewed) errors.push('Revisa y confirma el fragmento original.')
  if (throughStep >= 2) {
    if (!p.proposition.trim()) errors.push('Expresa el concepto con tus palabras.')
    if (p.needsResearch) errors.push('Resuelve primero lo que necesitas investigar.')
    if (p.proposition.trim() === unit?.text?.trim() && !p.quoteNecessary) errors.push('Has copiado la fuente: reformula o indica que la cita es indispensable.')
    if (p.conceptKind === 'argument' && (!lines(p.premises).length || !p.conclusion.trim() || !p.why.trim())) errors.push('El argumento necesita premisas, conclusión y justificación.')
  }
  if (throughStep >= 3 && (p.foundational ? !p.foundation.trim() : !p.linkedConceptId || !p.linkExplanation.trim())) errors.push('Justifica su carácter fundacional o enlaza un concepto anterior.')
  if (throughStep >= 4 && (!p.palaceId || !p.macroId || !p.locusId)) errors.push('Elige un locus libre dentro de una macro-estación y un palacio.')
  if (throughStep >= 5 && (![p.agent, p.action, p.symbol, p.distinctiveCue, p.mapping].every((value) => value.trim()) || !p.mentalRehearsal)) errors.push('Completa la escena, su correspondencia y el ensayo mental.')
  if (throughStep >= 6 && (!p.prompt.trim() || !p.distinction.trim() || !p.sceneDistinguished)) errors.push('Explica cómo distingues esta escena de las vecinas y escribe una pregunta sin solución.')
  if (throughStep >= 7 && (!p.entranceAttempted || !p.entrancePassed || !p.meaningConfirmed)) errors.push('Debes recuperar y comprobar el significado en el examen de entrada antes de publicar.')
  return errors
}

export function buildEncodingBundle({ userId, unit, revision, payload, encodingId, draftId, requestHash, now = Date.now() }) {
  validateUnitAgainstRevision(unit, revision)
  if (unit.userId !== userId) throw new Error('La unidad pertenece a otra cuenta.')
  const p = workshopPayloadSchema.parse(payload)
  const problems = workshopIssues(p, unit)
  if (problems.length) throw new Error(problems.join(' '))
  const common = { userId, schemaVersion: 1, version: 1, createdAt: toTimestamp(now) }
  const conceptId = `${encodingId}_concept`
  const targets = targetsForMode(p.mode)
  const concept = conceptSchema.parse({ ...common, id: conceptId, encodingId, canonicalProposition: p.proposition.trim(), kind: p.conceptKind, terms: lines(p.terms), premises: lines(p.premises), conclusion: p.conclusion.trim(), whyItFollows: p.why.trim(), status: 'reviewed' })
  const scene = sceneSchema.parse({ agent: p.agent.trim(), action: p.action.trim(), symbol: p.symbol.trim(), distinctiveCue: p.distinctiveCue.trim(), sensoryDetails: lines(p.sensoryDetails), conceptMapping: p.mapping.trim() })
  const encoding = encodingSchema.parse({ ...common, id: encodingId, unitId: unit.id, unitRevision: unit.unitRevision, sourceRevisionId: unit.sourceRevisionId, conceptId, conceptVersion: 1, locusId: p.locusId, palaceId: p.palaceId, macroId: p.macroId, scene, retrievalPrompt: p.prompt.trim(), qualityGate: { sourceReviewed: p.sourceReviewed, objectiveSelected: true, foundational: p.foundational, foundationJustification: p.foundation.trim(), linkedConceptId: p.foundational ? null : p.linkedConceptId, sceneDistinguished: p.sceneDistinguished, initialRecallAttempted: p.entranceAttempted, entranceExamPassed: p.entrancePassed, userConfirmedMeaning: p.meaningConfirmed }, status: 'active', requestHash, draftId, targets, edgeId: p.foundational ? null : `${encodingId}_edge` })
  const cards = targets.map((target) => ({ ...common, id: `${encodingId}_${target}`, unitId: unit.id, encodingId, encodingVersion: 1, target, lifecycle: 'active', scheduler: newScheduler(now), dueAt: toTimestamp(now), lastReviewedAt: null, lastEventId: null }))
  return { concept, encoding, cards, edge: p.foundational ? null : { ...common, id: `${encodingId}_edge`, encodingId, fromConceptId: conceptId, toConceptId: p.linkedConceptId, type: p.edgeType, explanation: p.linkExplanation.trim(), evidenceUnitIds: [unit.id] } }
}
