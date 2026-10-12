import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { Bytes, doc, GeoPoint, getFirestore, refEqual, Timestamp } from 'firebase/firestore'
import { decodeValue, encodeValue, canonicalJson } from '@icarus/domain/codec'
import { firestoreValueAdapter } from '../../src/data/firestore/backupRepository.js'

const app = initializeApp({ projectId: 'demo-codec-tests' }, 'codec-tests')
const db = getFirestore(app)
after(() => deleteApp(app))

test('codec Firebase v10: restaura Timestamp con nanosegundos, GeoPoint, Bytes y referencias', () => {
  const adapter = firestoreValueAdapter(db)
  const original = { time: new Timestamp(1700000000, 123456789), location: new GeoPoint(-33.45, -70.66), bytes: Bytes.fromUint8Array(new Uint8Array([0, 255, 17])), reference: doc(db, 'texts', 'example') }
  const encoded = encodeValue(original, adapter)
  const restored = decodeValue(JSON.parse(JSON.stringify(encoded)), adapter)
  assert.equal(original.time.isEqual(restored.time), true)
  assert.equal(original.location.isEqual(restored.location), true)
  assert.equal(original.bytes.isEqual(restored.bytes), true)
  assert.equal(refEqual(original.reference, restored.reference), true)
  assert.equal(canonicalJson(encodeValue(restored, adapter)), canonicalJson(encoded))
})
