import { useEffect, useRef, useState } from 'react'
import { emptyWorkshop } from '@icarus/domain/encoding'
import { db } from '../../firebase.js'
import { readUnitContext, saveWorkshopDraft } from '../firestore/cognitiveRepository.js'
import { learningError } from '../errors.js'

export function useWorkshopDraft(uid, unitId) {
  const [context, setContext] = useState(null)
  const [payload, setPayload] = useState(null)
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const version = useRef(0)
  const latest = useRef(null)
  const savedKey = useRef('')
  const queue = useRef(Promise.resolve())
  const active = useRef(true)
  latest.current = payload ? { payload, step } : null
  useEffect(() => {
    let cancelled = false
    active.current = true
    readUnitContext(db, uid, unitId).then((result) => {
      if (cancelled || !active.current) return
      const data = result.draft?.payload ?? emptyWorkshop(result.source.kind)
      version.current = result.draft?.version ?? 0
      savedKey.current = result.draft ? JSON.stringify({ payload: data, step: result.draft.step }) : ''
      const published = result.unit.status === 'ready'
      setContext(result); setPayload(published ? data : { ...data, entranceAttempted: false, entrancePassed: false, meaningConfirmed: false }); setStep(result.draft?.step ?? 0); setStatus(published ? 'saved' : 'pending')
    }).catch((failure) => { if (!cancelled && active.current) { setError(learningError(failure)); setStatus('error') } })
    return () => { cancelled = true; active.current = false }
  }, [uid, unitId])

  function flush() {
    const current = latest.current
    if (!current) return Promise.reject(new Error('El Taller aún no está cargado.'))
    const key = JSON.stringify(current)
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (key === savedKey.current) return version.current
      if (active.current) { setStatus('saving'); setError('') }
      try {
        version.current = await saveWorkshopDraft(db, uid, unitId, current.payload, current.step, version.current)
        savedKey.current = key
        if (active.current) setStatus(JSON.stringify(latest.current) === key ? 'saved' : 'pending')
        return version.current
      } catch (failure) {
        if (active.current) { setStatus('error'); setError(learningError(failure)) }
        throw failure
      }
    })
    return queue.current
  }
  // flush reads the latest ref, and the queued transaction always uses the latest
  // acknowledged version. Editing during a save does not overwrite new input.
  useEffect(() => {
    if (!payload || context?.unit?.status === 'ready') return undefined
    const timer = setTimeout(() => { flush().catch(() => {}) }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, step, context, uid, unitId])
  function update(key, value) {
    setPayload((current) => ({ ...current, [key]: value, ...(['entranceAttempted', 'entrancePassed', 'meaningConfirmed'].includes(key) ? {} : { entranceAttempted: false, entrancePassed: false, meaningConfirmed: false }) }))
    setStatus('pending')
  }
  return { context, payload, step, setStep, update, flush, status, error }
}
