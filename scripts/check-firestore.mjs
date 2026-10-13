import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { requiredPrivateIndexes } from '../src/data/firestore/privateQueries.js'

const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'))
assert.equal(config.firestore.rules, 'firestore.rules', 'Firebase debe publicar las reglas verificadas por las pruebas.')
assert.equal(config.firestore.indexes, 'firestore.indexes.json')
const manifest = JSON.parse(await readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'))
const required = requiredPrivateIndexes()
for (const spec of required) {
  assert.ok(manifest.indexes.some((index) => {
    if (index.collectionGroup !== spec.collectionGroup || index.queryScope !== spec.queryScope) return false
    const fields = index.fields.filter((field) => field.fieldPath !== '__name__')
    const name = index.fields.find((field) => field.fieldPath === '__name__')
    return JSON.stringify(fields) === JSON.stringify(spec.fields) && (!name || name === index.fields.at(-1) && name.order === 'ASCENDING')
  }), `Falta el índice requerido: ${JSON.stringify(spec)}`)
}
assert.deepEqual(manifest.fieldOverrides, [], 'No desactives los índices de campo único utilizados por estas consultas.')
console.log(`Contrato local de Firestore verificado: ${required.length} índices compuestos. El estado de los índices desplegados debe comprobarse en Firebase.`)
