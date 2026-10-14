export const GUIDANCE_VERSION = 1
export const DEFAULT_GUIDANCE = Object.freeze({ version: GUIDANCE_VERSION, mode: 'guided', introduction: 'new' })
export const preferenceKey = (uid) => `memorizador-solar:guidance:v1:${encodeURIComponent(uid)}`

export function parseGuidancePreference(value) {
  try {
    const parsed = JSON.parse(value)
    if (parsed?.version === GUIDANCE_VERSION && ['guided', 'normal'].includes(parsed.mode)
      && ['new', 'skipped', 'completed'].includes(parsed.introduction)) {
      return { version: GUIDANCE_VERSION, mode: parsed.mode, introduction: parsed.introduction }
    }
  } catch { /* Una preferencia dañada no bloquea la aplicación. */ }
  return { ...DEFAULT_GUIDANCE }
}

export function loadGuidancePreference(uid, storage) {
  try { return { preference: parseGuidancePreference(storage.getItem(preferenceKey(uid))), available: true } }
  catch { return { preference: { ...DEFAULT_GUIDANCE }, available: false } }
}

export function saveGuidancePreference(uid, preference, storage) {
  try {
    const serialized = JSON.stringify(parseGuidancePreference(JSON.stringify(preference)))
    if (storage.getItem(preferenceKey(uid)) !== serialized) storage.setItem(preferenceKey(uid), serialized)
    return true
  } catch { return false }
}
