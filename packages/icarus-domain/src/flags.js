export const ICARUS_PHASE = 'foundation'
export const DEFAULT_PROFILE = Object.freeze({
  schemaVersion: 1,
  icarusEnabled: false,
  legacyWritesLocked: false,
})

export function getIcarusCapabilities(profile = DEFAULT_PROFILE, preparationEnabled = false) {
  return Object.freeze({
    phase: ICARUS_PHASE,
    preparationAvailable: preparationEnabled === true,
    requested: profile?.icarusEnabled === true,
    studyAvailable: false,
    productionMigrationAvailable: false,
    legacyWritesLocked: profile?.legacyWritesLocked === true,
  })
}
