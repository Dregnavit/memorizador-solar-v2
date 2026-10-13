import { errorMessage } from '../lib.js'
import { MigrationError } from '@icarus/domain/migration'
export const learningError = (error) => error instanceof MigrationError ? error.message : error?.name === 'ZodError' ? 'Revisa los campos y sus límites antes de guardar.' : error?.code ? errorMessage(error) : error?.message || 'No se pudo completar la operación.'
