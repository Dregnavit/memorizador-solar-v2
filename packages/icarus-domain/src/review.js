export const RATINGS = ['again', 'hard', 'good', 'easy']
export const REVIEW_STAGES = { concept: ['ORIENT', 'SCENE_RECALL', 'MEANING_RECALL', 'STRUCTURE', 'REVEAL', 'RATE'], explanation: ['ORIENT', 'SCENE_RECALL', 'MEANING_RECALL', 'STRUCTURE', 'REVEAL', 'RATE'], verbatim: ['ORIENT', 'VERBATIM', 'REVEAL', 'RATE'] }
export function newRecall(target) {
  if (!REVIEW_STAGES[target]) throw new Error('Objetivo de repaso no disponible.')
  return { target, phase: 'ORIENT', attempts: {}, highestHint: 0, failed: false, checklist: { mainIdea: false, explanation: false, exact: false, noCriticalError: false }, revealed: false }
}
export function stageCompletion(context) {
  const has = (name) => typeof context?.attempts?.[name] === 'string' && Boolean(context.attempts[name].trim())
  return { scene: has('SCENE_RECALL'), meaning: has('MEANING_RECALL'), structure: has('STRUCTURE'), verbatim: has('VERBATIM') }
}
export function recallSucceeded(context) {
  const done = stageCompletion(context)
  const checks = context?.checklist
  return !context?.failed && checks?.noCriticalError === true && (context.target === 'verbatim' ? done.verbatim && checks.exact === true : done.scene && done.meaning && done.structure && checks.mainIdea === true && (context.target !== 'explanation' || checks.explanation === true))
}
export function maximumRating(context) {
  if (!recallSucceeded(context) || context.highestHint >= 3) return 'again'
  return context.highestHint === 2 ? 'hard' : context.highestHint === 1 ? 'good' : 'easy'
}
export function validateRating(context, rating) {
  if (context.phase !== 'RATE' || !context.revealed || !RATINGS.includes(rating) || RATINGS.indexOf(rating) > RATINGS.indexOf(maximumRating(context))) throw new Error('La nota excede lo permitido por el intento, las pistas o la autoevaluación.')
  return rating
}
export function recallReducer(context, action) {
  if (action.type === 'CHECK' && context.phase === 'REVEAL' && Object.hasOwn(context.checklist, action.key)) return { ...context, checklist: { ...context.checklist, [action.key]: action.value === true } }
  if (action.type === 'FAIL' && !['REVEAL', 'RATE', 'COMMIT', 'DONE'].includes(context.phase)) return { ...context, phase: 'REVEAL', failed: true, revealed: true }
  if (action.type === 'HINT' && !['ORIENT', 'REVEAL', 'RATE', 'COMMIT', 'DONE'].includes(context.phase) && typeof action.attempt === 'string' && action.attempt.trim()) return { ...context, attempts: { ...context.attempts, [context.phase]: action.attempt }, highestHint: Math.min(3, context.highestHint + 1) }
  if (action.type === 'NEXT') {
    const route = REVIEW_STAGES[context.target]
    if (context.phase === 'ORIENT') return { ...context, phase: route[1] }
    if (context.phase === 'REVEAL') return { ...context, phase: 'RATE' }
    if (['SCENE_RECALL', 'MEANING_RECALL', 'STRUCTURE', 'VERBATIM'].includes(context.phase) && typeof action.attempt === 'string' && action.attempt.trim()) {
      const next = route[route.indexOf(context.phase) + 1]
      return { ...context, phase: next, revealed: next === 'REVEAL', attempts: { ...context.attempts, [context.phase]: action.attempt.trim() } }
    }
  }
  if (action.type === 'COMMIT' && context.phase === 'RATE') { validateRating(context, action.rating); return { ...context, phase: 'COMMIT' } }
  if (action.type === 'RETRY' && context.phase === 'COMMIT') return { ...context, phase: 'RATE' }
  if (action.type === 'DONE' && context.phase === 'COMMIT') return { ...context, phase: 'DONE' }
  return context
}
export function literalDiff(expected, actual) {
  const source = typeof expected === 'string' ? Array.from(expected) : []
  const response = typeof actual === 'string' ? Array.from(actual) : []
  let firstDifference = 0
  while (firstDifference < Math.min(source.length, response.length) && source[firstDifference] === response[firstDifference]) firstDifference += 1
  return { exact: typeof expected === 'string' && typeof actual === 'string' && expected === actual, firstDifference, expectedLength: source.length, actualLength: response.length }
}
