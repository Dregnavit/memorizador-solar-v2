export const DAY_MS = 86400000

export function normalizeProgress(value) {
  return {
    interval: Number.isSafeInteger(value?.interval) && value.interval >= 0 ? value.interval : 0,
    ease: Number.isFinite(value?.ease) && value.ease >= 1.3 ? value.ease : 2.5,
    nextReview: Number.isFinite(value?.nextReview) && value.nextReview >= 0 ? value.nextReview : 0,
  }
}

export function calculateReview(previous, rating, now = Date.now()) {
  if (![1, 2, 3, 4].includes(rating)) throw new Error('Calificación no válida.')
  if (!Number.isFinite(now) || now < 0) throw new Error('Fecha no válida.')
  let { interval, ease } = normalizeProgress(previous)
  if (rating === 1) {
    interval = 0
    ease = Math.max(1.3, ease - 0.2)
  } else if (rating === 2) {
    interval = Math.max(1, Math.round(interval * 1.2))
    ease = Math.max(1.3, ease - 0.15)
  } else if (rating === 3) {
    interval = interval === 0 ? 1 : Math.round(interval * 2.5)
  } else {
    interval = interval === 0 ? 4 : Math.round(interval * ease * 1.3)
    ease += 0.15
  }
  const nextReview = now + interval * DAY_MS
  if (!Number.isSafeInteger(nextReview) || nextReview > 8640000000000000) {
    throw new Error('El intervalo calculado excede el rango de fechas permitido.')
  }
  return { interval, ease, nextReview }
}

export const isDue = (progress, now = Date.now()) => normalizeProgress(progress).nextReview <= now

export const LegacySchedulerAdapter = Object.freeze({
  algorithm: 'legacy-v1',
  apply: calculateReview,
  preview(previous, now = Date.now()) {
    return Object.fromEntries([1, 2, 3, 4].map((rating) => [rating, calculateReview(previous, rating, now)]))
  },
})
