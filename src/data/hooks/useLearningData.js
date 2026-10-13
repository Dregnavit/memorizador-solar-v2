import { sourceSchema, unitSchema, conceptSchema, cardSchema } from '@icarus/domain/schemas'
import { recordContract } from '../firestore/cognitiveRepository.js'
import { learningQueryName } from '../firestore/privateQueries.js'
import { usePrivateRead } from './usePrivateRead.js'

const schemas = { sources: sourceSchema, units: unitSchema, concepts: conceptSchema, cards: cardSchema }

export function useLearningData(uid, kind, field = null, value = null, sort = 'createdAt') {
  return usePrivateRead(uid, learningQueryName(kind, field, sort), value, schemas[kind], recordContract)
}
