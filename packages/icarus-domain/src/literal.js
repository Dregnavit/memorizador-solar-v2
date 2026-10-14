import { z } from 'zod'
import { idSchema, uidSchema, schedulerEnvelopeSchema } from './schemas.js'
import { timestampSchema } from './codec.js'

export const comparisonProfileSchema = z.object({ version: z.literal(1), caseSensitive: z.boolean(), punctuation: z.boolean(), diacritics: z.boolean(), whitespace: z.enum(['exact', 'collapse', 'ignore']), latinIJ: z.boolean(), latinUV: z.boolean() }).strict()
export const STRICT_PROFILE = Object.freeze({ version: 1, caseSensitive: true, punctuation: true, diacritics: true, whitespace: 'exact', latinIJ: false, latinUV: false })
export function normalizeLiteral(value, profile = STRICT_PROFILE) {
  comparisonProfileSchema.parse(profile)
  if (typeof value !== 'string') throw new Error('Se esperaba texto.')
  let text = value.normalize('NFC')
  if (!profile.caseSensitive) text = text.toLocaleLowerCase('und')
  if (!profile.diacritics) text = text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
  if (profile.latinIJ) text = text.replace(/j/g, 'i').replace(/J/g, 'I')
  if (profile.latinUV) text = text.replace(/v/g, 'u').replace(/V/g, 'U')
  if (!profile.punctuation) text = text.replace(/\p{P}/gu, '')
  if (profile.whitespace === 'collapse') text = text.replace(/\s+/gu, ' ').trim()
  if (profile.whitespace === 'ignore') text = text.replace(/\s/gu, '')
  return text
}
function tokens(text, profile, lexical = false, language = 'und') {
  let parts
  try { parts = [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text)].map((part) => ({ text: part.segment, start: part.index, end: part.index + part.segment.length, word: part.isWordLike })) }
  catch { parts = [...text.matchAll(/[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu)].map((part) => ({ text: part[0], start: part.index, end: part.index + part[0].length, word: /[\p{L}\p{N}]/u.test(part[0]) })) }
  return parts.filter((part) => lexical ? part.word : /\s/u.test(part.text) ? profile.whitespace === 'exact' : part.word || profile.punctuation || !/\p{P}/u.test(part.text)).map((part) => ({ ...part, key: normalizeLiteral(part.text, { ...profile, whitespace: 'exact' }) }))
}
// Bounded alignment: common prefix/suffix are linear; ambiguous optimal paths are reported.
function align(a, b, maxCells) {
  let first = 0; let last = 0
  while (first < a.length && first < b.length && a[first].key === b[first].key) first++
  while (last < a.length - first && last < b.length - first && a[a.length - 1 - last].key === b[b.length - 1 - last].key) last++
  const n = a.length - first - last; const m = b.length - first - last
  if ((n + 1) * (m + 1) > maxCells) return { complete: false, operations: [], ambiguous: true, errors: null }
  const directions = new Uint8Array((n + 1) * (m + 1)); let previous = new Uint32Array(m + 1); let paths = new Uint8Array(m + 1).fill(1)
  for (let j = 1; j <= m; j++) { previous[j] = j; directions[j] = 2 }
  for (let i = 1; i <= n; i++) {
    const current = new Uint32Array(m + 1); const currentPaths = new Uint8Array(m + 1); current[0] = i; currentPaths[0] = 1; directions[i * (m + 1)] = 1
    for (let j = 1; j <= m; j++) {
      const cost = a[first + i - 1].key === b[first + j - 1].key ? 0 : 1
      const diagonal = previous[j - 1] + cost; const omit = previous[j] + 1; const insert = current[j - 1] + 1
      const best = Math.min(diagonal, omit, insert); current[j] = best
      currentPaths[j] = Math.min(2, (diagonal === best ? paths[j - 1] : 0) + (omit === best ? paths[j] : 0) + (insert === best ? currentPaths[j - 1] : 0))
      directions[i * (m + 1) + j] = diagonal === best ? 0 : omit === best ? 1 : 2
    }
    previous = current; paths = currentPaths
  }
  let i = n; let j = m; const operations = []
  while (i || j) {
    const direction = directions[i * (m + 1) + j]
    if (direction === 0 && i && j) { const original = a[first + --i]; const attempted = b[first + --j]; operations.push({ type: original.key === attempted.key ? 'equal' : 'substitution', original, attempted }) }
    else if (direction === 1 && i) operations.push({ type: 'omission', original: a[first + --i] })
    else operations.push({ type: 'insertion', attempted: b[first + --j] })
  }
  operations.reverse()
  const count = (values) => values.reduce((map, value) => map.set(value.key, (map.get(value.key) || 0) + 1), new Map())
  const frequencies = count(a); const other = count(b)
  const removed = new Set(operations.filter((op) => op.type === 'omission').map((op) => op.original.key))
  const inserted = new Set(operations.filter((op) => op.type === 'insertion').map((op) => op.attempted.key))
  const swaps = new Map(operations.filter((op) => op.type === 'substitution').map((op) => [op.original.key, op.attempted.key]))
  const possibleMovement = [...removed].some((key) => inserted.has(key)) || [...swaps].some(([from, to]) => from !== to && swaps.get(to) === from)
  const orderChanged = a.length === b.length && [...frequencies].every(([key, value]) => other.get(key) === value) && a.some((token, index) => token.key !== b[index].key)
  const repeated = operations.some((op) => op.type !== 'equal' && (frequencies.get(op.original?.key) > 1 || other.get(op.attempted?.key) > 1))
  return { complete: true, operations, errors: previous[m], ambiguous: paths[m] > 1 || repeated, orderChanged, possibleMovement }
}
export function compareLiteral(original, attempt, profile = STRICT_PROFILE, { language = 'und', maxCells = 4000000 } = {}) {
  if (typeof original !== 'string' || typeof attempt !== 'string' || original.length > 60000 || attempt.length > 120000) throw new Error('Texto fuera del límite de comparación (60.000/120.000 caracteres).')
  comparisonProfileSchema.parse(profile)
  const expected = tokens(original, profile, false, language); const actual = tokens(attempt, profile, false, language)
  const lexicalProfile = { ...profile, punctuation: false, whitespace: 'ignore' }
  const lexicalExpected = tokens(original, lexicalProfile, true, language); const lexicalActual = tokens(attempt, lexicalProfile, true, language)
  const result = align(expected, actual, maxCells)
  const words = align(lexicalExpected, lexicalActual, maxCells)
  const conforms = normalizeLiteral(original, profile) === normalizeLiteral(attempt, profile)
  return { ...result, rawExact: original === attempt, conforms, lexicalExact: lexicalExpected.length === lexicalActual.length && lexicalExpected.every((token, index) => token.key === lexicalActual[index].key), wordCount: lexicalExpected.length, lexicalSimilarity: words.complete ? Math.max(0, Math.round((1 - words.errors / Math.max(1, lexicalExpected.length, lexicalActual.length)) * 100)) : null }
}
function validBoundary(text, offset) { return Number.isInteger(offset) && offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])) }
export function segmentLiteral(text, mode = 'verses', cuts = [], language = 'und') {
  if (typeof text !== 'string' || !text.trim() || text.length > 60000) throw new Error('Introduce un original de hasta 60.000 caracteres.')
  let boundaries = [0]
  if (mode === 'manual') boundaries.push(...cuts)
  else if (mode === 'sentences') {
    try { boundaries.push(...[...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)].map((part) => part.index).filter(Boolean)) }
    catch { boundaries.push(...[...text.matchAll(/[.!?。！？]+\s*|\n+/gu)].map((match) => match.index + match[0].length)) }
  } else {
    const pattern = mode === 'stanzas' || mode === 'paragraphs' ? /(?:\r?\n)[\t ]*(?:\r?\n)+/g : mode === 'verses' || mode === 'versicles' ? /\r?\n/g : null
    if (!pattern) throw new Error('Segmentación no admitida.')
    boundaries.push(...[...text.matchAll(pattern)].map((part) => part.index + part[0].length))
  }
  boundaries.push(text.length); boundaries = [...new Set(boundaries)].sort((a, b) => a - b)
  if (boundaries.some((offset) => !validBoundary(text, offset))) throw new Error('Un corte divide un carácter Unicode o está fuera del texto.')
  const segments = boundaries.slice(0, -1).map((start, i) => ({ startOffset: start, endOffset: boundaries[i + 1], text: text.slice(start, boundaries[i + 1]), ordinal: i }))
  // Whitespace is retained in the adjoining segment; no join(' ') reconstruction.
  for (let i = segments.length - 1; i >= 0; i--) if (!segments[i].text.trim() && segments.length > 1) {
    if (i) { segments[i - 1].endOffset = segments[i].endOffset; segments[i - 1].text += segments[i].text; segments.splice(i, 1) }
    else { segments[1].startOffset = 0; segments[1].text = segments[i].text + segments[1].text; segments.splice(0, 1) }
  }
  if (segments.length > 200) throw new Error('La preparación admite hasta 200 segmentos. Combina cortes para continuar.')
  return segments.map((segment, ordinal) => ({ ...segment, ordinal }))
}
export function exercisePlan(count, { kind = 'accumulative', start = 0, end = count, blockSize = 4, maxExercises = 40 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 200 || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > count || start >= end || !Number.isInteger(blockSize) || blockSize < 2 || blockSize > 20 || !Number.isInteger(maxExercises) || maxExercises < 1 || maxExercises > 100) throw new Error('Límites del recorrido no válidos.')
  const result = []; const add = (from, to, scope) => result.push({ start: from, end: to, scope })
  if (kind === 'whole') add(0, count, 'whole')
  else if (kind === 'section') add(start, end, 'section')
  else if (kind === 'transitions') for (let i = start; i < end - 1; i++) add(i, i + 2, 'transition')
  else if (kind === 'segments') for (let i = start; i < end; i++) add(i, i + 1, 'segment')
  else if (kind === 'accumulative') for (let base = start; base < end; base += blockSize) for (let i = base; i < Math.min(end, base + blockSize); i++) {
    add(i, i + 1, 'segment')
    if (i > base) add(base, i + 1, 'sequence')
    if (i > base + 1) add(i - 1, i + 1, 'transition')
  } else throw new Error('Ejercicio no admitido.')
  return result.slice(0, maxExercises)
}
export function literalRatingCap({ complete, conforms, highestHint, revealed, verification, manualCorrect, retry }) {
  if (!complete || revealed || retry || highestHint >= 3 || !(verification === 'manual' ? manualCorrect === true : conforms)) return 'again'
  if (highestHint >= 2) return 'hard'
  if (highestHint >= 1 || verification === 'manual') return 'good'
  return 'easy'
}
const base = { id: idSchema, userId: uidSchema, schemaVersion: z.literal(2), version: z.number().int().positive(), createdAt: timestampSchema }
export const literalProgramSchema = z.object({ ...base, sourceId: idSchema, sourceRevisionId: idSchema, goal: z.enum(['literal', 'combined']), profile: comparisonProfileSchema, unitIds: z.array(idSchema).min(1).max(200), ranges: z.array(z.object({ startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive() }).strict()).min(1).max(200), contentHash: z.string(), requestHash: z.string() }).strict()
export const literalCardSchema = z.object({ ...base, sourceId: idSchema, programId: idSchema, exerciseId: idSchema, scope: z.enum(['segment', 'sequence', 'transition', 'section', 'whole']), start: z.number().int().nonnegative(), end: z.number().int().positive(), lifecycle: z.literal('active'), scheduler: schedulerEnvelopeSchema, dueAt: timestampSchema, lastReviewedAt: timestampSchema.nullable(), lastEventId: idSchema.nullable() }).strict()

export const literalExerciseSchema = z.object({ ...base, sourceId: idSchema, programId: idSchema, sourceRevisionId: idSchema, start: z.number().int().nonnegative(), end: z.number().int().positive(), scope: z.enum(['segment', 'sequence', 'transition', 'section', 'whole']) }).strict()
export const literalBindingSchema = z.object({ ...base, sourceId: idSchema, programId: idSchema, sourceRevisionId: idSchema, start: z.number().int().nonnegative(), end: z.number().int().positive(), locusId: idSchema, purpose: z.enum(['sequence', 'start', 'transition']), scene: z.string().max(4000) }).strict()
export const literalAttemptSchema = z.object({ ...base, sourceId: idSchema, programId: idSchema, cardId: idSchema, exerciseId: idSchema, scope: z.enum(['segment', 'sequence', 'transition', 'section', 'whole']), requestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/), rating: z.enum(['again', 'hard', 'good', 'easy']), cap: z.enum(['again', 'hard', 'good', 'easy']), verification: z.enum(['automatic', 'manual']), highestHint: z.number().int().min(0).max(3), revealed: z.boolean(), manualCorrect: z.boolean(), complete: z.boolean(), conforms: z.boolean(), rawExact: z.boolean(), lexicalSimilarity: z.number().min(0).max(100).nullable(), ambiguous: z.boolean(), profile: comparisonProfileSchema, previousCardVersion: z.number().int().positive(), newCardVersion: z.number().int().positive(), schedulerBefore: schedulerEnvelopeSchema, schedulerAfter: schedulerEnvelopeSchema, dueBefore: timestampSchema, dueAfter: timestampSchema, responseRetention: z.enum(['metadata-only', 'opt-in']), attemptText: z.string().max(120000).optional() }).strict().refine((event) => event.newCardVersion === event.previousCardVersion + 1 && (event.responseRetention === 'opt-in' || event.attemptText === undefined), 'Evento literal incoherente.')

export function originalOffsetFromTextarea(original, displayedOffset) {
  if (typeof original !== 'string' || !Number.isInteger(displayedOffset) || displayedOffset < 0) throw new Error('Posición de selección no válida.')
  let displayed = 0; let index = 0
  while (index < original.length && displayed < displayedOffset) { if (original[index] === '\r' && original[index + 1] === '\n') index++; index++; displayed++ }
  return index
}
