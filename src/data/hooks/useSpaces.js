import { SPACE_TYPES, spaceContract } from '../firestore/spacesRepository.js'
import { PRIVATE_PAGE_SIZE } from '../firestore/privateQueries.js'
import { usePrivateRead } from './usePrivateRead.js'

export const SPACE_PAGE_SIZE = PRIVATE_PAGE_SIZE

export function useSpaces(userId, kind, parentId = null) {
  const type = SPACE_TYPES[kind]
  const data = usePrivateRead(userId, type?.collection, parentId, type?.schema, spaceContract)
  return { ...data, pageNumber: data.page, nextPage: data.next, previousPage: data.back }
}
