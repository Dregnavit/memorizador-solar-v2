import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { DEFAULT_PROFILE } from '@icarus/domain/flags'
import { profileSchema } from '@icarus/domain/schemas'
import { db } from '../../firebase'

export function useIcarusProfile(userId) {
  const [state, setState] = useState({ profile: DEFAULT_PROFILE, status: 'loading' })
  useEffect(() => {
    if (!db || !userId) return undefined
    return onSnapshot(doc(db, 'users', userId, 'settings', 'profile'), (snapshot) => {
      const result = profileSchema.safeParse(snapshot.exists() ? snapshot.data() : DEFAULT_PROFILE)
      setState(result.success ? { profile: result.data, status: 'ready' } : { profile: DEFAULT_PROFILE, status: 'invalid' })
    }, () => setState({ profile: DEFAULT_PROFILE, status: 'unavailable' }))
  }, [userId])
  return state
}
