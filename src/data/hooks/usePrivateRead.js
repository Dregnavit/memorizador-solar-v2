import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { buildPrivateQuery, PRIVATE_QUERIES } from '../firestore/privateQueries.js'
import { emptyReadState, failedReadState, loadingReadState, subscribePrivateRead } from '../firestore/readState.js'

export function usePrivateRead(uid, queryName, value, schema, contract) {
  const scope = JSON.stringify([uid, queryName, value])
  const [pager, setPager] = useState({ scope, cursor: null, prior: [] })
  const [state, setState] = useState({ ...emptyReadState(), scope: null, cursor: null })
  const [retryCount, setRetryCount] = useState(0)
  const page = pager.scope === scope ? pager : { scope, cursor: null, prior: [] }
  const cursor = page.cursor
  const spec = PRIVATE_QUERIES[queryName]
  const enabled = Boolean(db && uid && (!spec?.field || value !== null && value !== undefined))

  useEffect(() => {
    if (!enabled) return undefined
    const context = { projectId: db.app.options.projectId, collection: spec?.collection, queryName }
    const onState = (next) => setState({ ...next, scope, cursor })
    onState(loadingReadState())
    try {
      const reference = buildPrivateQuery(db, uid, queryName, { value, cursor })
      return subscribePrivateRead(reference, { subscribe: onSnapshot, uid, schema, contract, context, onState })
    } catch (failure) {
      onState(failedReadState(failure, context))
      return undefined
    }
  }, [uid, queryName, value, spec, scope, cursor, enabled, retryCount, schema, contract])

  const current = !enabled ? emptyReadState() : state.scope === scope && state.cursor === cursor ? state : loadingReadState()
  return {
    ...current, page: page.prior.length + 1, canGoBack: page.prior.length > 0,
    next() {
      if (current.status === 'ready' && current.hasMore && current.last) setPager({ scope, cursor: current.last, prior: [...page.prior, cursor] })
    },
    back() {
      if (page.prior.length && !current.loading) setPager({ scope, cursor: page.prior.at(-1), prior: page.prior.slice(0, -1) })
    },
    retry() { setRetryCount((count) => count + 1) },
  }
}
