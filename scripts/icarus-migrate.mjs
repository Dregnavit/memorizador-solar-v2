import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPlanToMemory, createLegacyBackup, createMigrationPlan, MemoryMigrationStore, MigrationError, restoreBackupToMemory, simulateMigration, verifyLegacyBackup } from '@icarus/domain/migration'

export async function runLocalCommand(command, input, expectedUserId) {
  if (command === 'backup') return createLegacyBackup(input)
  if (command === 'verify') {
    const backup = await verifyLegacyBackup(input, expectedUserId)
    return { valid: true, backupHash: backup.backupHash, ...backup.manifest }
  }
  if (command === 'plan') return createMigrationPlan(input, expectedUserId)
  if (command === 'restore') {
    const restored = await restoreBackupToMemory(input, undefined, expectedUserId)
    return { mode: 'local-memory-restore', restoredDocumentCount: restored.restoredDocumentCount, documents: restored.store.dump() }
  }
  if (command === 'simulate') {
    const backup = input.format === 'icarus-legacy-backup' ? input : await createLegacyBackup(input)
    return simulateMigration(backup, expectedUserId)
  }
  if (command === 'apply-local') {
    const store = new MemoryMigrationStore()
    const result = await applyPlanToMemory(input, store)
    return { mode: 'local-memory-only', ...result, documents: store.dump() }
  }
  throw new MigrationError('invalid-command', 'Comandos: backup, verify, plan, restore, simulate o apply-local. No hay comando de escritura en Firebase.')
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2)
  if (!command || ['--help', '-h'].includes(command)) {
    console.log('Uso: node scripts/icarus-migrate.mjs <backup|verify|plan|restore|simulate|apply-local> --input archivo.json [--output archivo.json] [--user UID]')
    console.log('Solo archivos y memoria local. Ningún comando escribe en Firebase.')
    return
  }
  const options = {}
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!['--input', '--output', '--user'].includes(key) || !value || value.startsWith('--') || options[key] !== undefined) throw new MigrationError('invalid-arguments', 'Usa --input archivo.json, --output archivo.json y opcionalmente --user UID.')
    options[key] = value
  }
  if (!options['--input']) throw new MigrationError('missing-input', 'Falta --input. La herramienta solo lee archivos locales.')
  const data = JSON.parse(await readFile(path.resolve(options['--input']), 'utf8'))
  const result = await runLocalCommand(command, data, options['--user'])
  if (options['--output']) {
    const destination = path.resolve(options['--output'])
    const content = `${JSON.stringify(result, null, 2)}\n`
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    try { await writeFile(destination, content, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (await readFile(destination, 'utf8') !== content) throw new MigrationError('output-exists', 'La salida ya existe y contiene otros datos. Elige otra ruta; no se sobrescribió.')
    }
    console.log(`Resultado local guardado: ${destination}`)
  }
  console.log(JSON.stringify({ mode: result.mode ?? 'local-file-only', valid: result.valid, summary: result.summary, verification: result.verification, documentCount: result.documents?.length }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof MigrationError ? error.message : 'No se pudo procesar el archivo: revisa el formato y los permisos.')
    process.exitCode = 1
  })
}
