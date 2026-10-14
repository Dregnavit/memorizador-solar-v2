// Compatible readers ship first. Production writes activate only after the new Rules are deployed.
// Node tests use only the demo emulator and validate the complete protocol.
export const EVOLUTION_ENABLED = typeof import.meta.env === 'object' ? import.meta.env.VITE_SOLAR_EVOLUTION_ENABLED === 'true' : true
