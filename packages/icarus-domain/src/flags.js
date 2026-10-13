export const ICARUS_PHASE = 'cognitive-mvp'
export const DEFAULT_PROFILE = Object.freeze({
  schemaVersion: 1,
  icarusEnabled: false,
  legacyWritesLocked: false,
})

export function getIcarusCapabilities(profile = DEFAULT_PROFILE, preparationEnabled = false, learningEnabled = false) {
  return Object.freeze({
    phase: ICARUS_PHASE,
    preparationAvailable: preparationEnabled === true,
    requested: profile?.icarusEnabled === true,
    studyAvailable: learningEnabled === true,
    productionMigrationAvailable: false,
    legacyWritesLocked: profile?.legacyWritesLocked === true,
  })
}
