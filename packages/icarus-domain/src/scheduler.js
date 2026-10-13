import { z } from 'zod'
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs'
import { decodeValue, encodeValue, toTimestamp } from './codec.js'
import { schedulerEnvelopeSchema } from './schemas.js'

export const FSRS_PACKAGE_VERSION = '5.4.2'
export const FSRS_PARAMETERS = Object.freeze(generatorParameters({ request_retention: 0.9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true }))
const states = ['new', 'learning', 'review', 'relearning']
const grades = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }
const cardState = z.object({ due: z.date(), stability: z.number().finite().nonnegative(), difficulty: z.number().finite().min(0).max(10), elapsed_days: z.number().finite().nonnegative(), scheduled_days: z.number().finite().nonnegative(), learning_steps: z.number().int().nonnegative(), reps: z.number().int().nonnegative(), lapses: z.number().int().nonnegative(), state: z.number().int().min(0).max(3), last_review: z.date().optional() }).strict()
function pack(card, parameters = FSRS_PARAMETERS) {
  const clean = Object.fromEntries(Object.entries(card).filter(([, value]) => value !== undefined))
  cardState.parse(clean)
  // Wire maps contain tuples; JSON avoids Firestore's prohibition of nested arrays.
  return schedulerEnvelopeSchema.parse({ algorithm: 'fsrs', packageVersion: FSRS_PACKAGE_VERSION, codecVersion: 2, state: states[card.state], snapshot: JSON.stringify(encodeValue({ card: clean, parameters })) })
}
export function unpackScheduler(envelope) {
  const parsed = schedulerEnvelopeSchema.parse(envelope)
  if (parsed.packageVersion !== FSRS_PACKAGE_VERSION || parsed.codecVersion !== 2 || typeof parsed.snapshot !== 'string') throw new Error('Versión FSRS no compatible; no se sobrescribió el estado.')
  const { card, parameters } = decodeValue(JSON.parse(parsed.snapshot))
  cardState.parse(card)
  if (states[card.state] !== parsed.state || JSON.stringify(parameters) !== JSON.stringify(decodeValue(encodeValue(FSRS_PARAMETERS)))) throw new Error('El estado o los parámetros FSRS no corresponden al codec actual.')
  return { card, parameters }
}
export function newScheduler(now = Date.now()) { return pack(createEmptyCard(new Date(now))) }
export function scheduleReview(envelope, rating, now = Date.now()) {
  if (!grades[rating] || !Number.isSafeInteger(now)) throw new Error('Nota o fecha FSRS no válida.')
  const { card, parameters } = unpackScheduler(envelope)
  if (card.last_review && now < card.last_review.getTime()) throw new Error('El reloj es anterior al último repaso.')
  const result = fsrs(parameters).next(card, new Date(now), grades[rating])
  return { scheduler: pack(result.card, parameters), dueAt: toTimestamp(result.card.due.getTime()) }
}
