import { z } from 'zod'

export const timestampSchema = z.object({
  seconds: z.number().int().min(-62135596800).max(253402300799),
  nanoseconds: z.number().int().min(0).max(999999999),
}).strict()

export const wireValueSchema = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.literal('null') }).strict(),
  z.object({ type: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('string'), value: z.string() }).strict(),
  z.object({ type: z.literal('number'), value: z.union([z.number().finite().refine((value) => !Object.is(value, -0), 'Usa el marcador explícito para -0.'), z.enum(['NaN', 'Infinity', '-Infinity', '-0'])]) }).strict(),
  z.object({ type: z.literal('timestamp'), value: timestampSchema }).strict(),
  z.object({ type: z.literal('date'), value: z.string().datetime() }).strict(),
  z.object({ type: z.literal('bytes'), value: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ type: z.literal('geopoint'), value: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict() }).strict(),
  z.object({ type: z.literal('reference'), value: z.object({ projectId: z.string().min(1), databaseId: z.string().min(1), path: z.string().min(1) }).strict() }).strict(),
  z.object({ type: z.literal('array'), value: z.array(wireValueSchema) }).strict(),
  z.object({ type: z.literal('map'), value: z.array(z.tuple([z.string(), wireValueSchema])) }).strict(),
]))

export class PortableFirestoreValue {
  constructor(wire) { this.wire = wireValueSchema.parse(wire) }
}

export function toTimestamp(milliseconds) {
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError('Fecha no válida.')
  const seconds = Math.floor(milliseconds / 1000)
  return timestampSchema.parse({ seconds, nanoseconds: (milliseconds - seconds * 1000) * 1000000 })
}

function base64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function encodeValue(input, adapter = {}) {
  const ancestors = new WeakSet()
  function visit(value, depth) {
    if (depth > 64) throw new Error('El respaldo excede la profundidad admitida.')
    if (value === null) return { type: 'null' }
    if (typeof value === 'string' || typeof value === 'boolean') return { type: typeof value, value }
    if (typeof value === 'number') {
      const number = Number.isNaN(value) ? 'NaN' : Object.is(value, -0) ? '-0' : !Number.isFinite(value) ? String(value) : value
      return { type: 'number', value: number }
    }
    if (value instanceof PortableFirestoreValue) return structuredClone(value.wire)
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new Error('Fecha inválida en el respaldo.')
      return { type: 'date', value: value.toISOString() }
    }
    if (value instanceof Uint8Array) return { type: 'bytes', value: base64(value) }
    const identified = adapter.identify?.(value)
    if (identified) return wireValueSchema.parse(identified)
    if (!value || typeof value !== 'object') throw new Error('Tipo no representable en un respaldo Firestore.')
    if (ancestors.has(value)) throw new Error('El respaldo contiene una referencia circular.')
    ancestors.add(value)
    let encoded
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new Error('El respaldo contiene un array incompleto o con propiedades adicionales.')
      encoded = { type: 'array', value: value.map((entry) => visit(entry, depth + 1)) }
    } else {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throw new Error('El respaldo contiene un objeto no compatible.')
      if (Object.getOwnPropertySymbols(value).length) throw new Error('El respaldo contiene propiedades no representables.')
      encoded = { type: 'map', value: Object.keys(value).sort().map((key) => [key, visit(value[key], depth + 1)]) }
    }
    ancestors.delete(value)
    return encoded
  }
  return wireValueSchema.parse(visit(input, 0))
}

export function decodeValue(input, adapter = {}) {
  const wire = wireValueSchema.parse(input)
  function visit(value) {
    if (value.type === 'null') return null
    if (value.type === 'string' || value.type === 'boolean') return value.value
    if (value.type === 'number') return value.value === '-0' ? -0 : typeof value.value === 'string' ? Number(value.value) : value.value
    if (value.type === 'array') return value.value.map(visit)
    if (value.type === 'map') {
      const keys = value.value.map(([key]) => key)
      if (new Set(keys).size !== keys.length) throw new Error('Claves duplicadas en un respaldo.')
      return Object.fromEntries(value.value.map(([key, entry]) => [key, visit(entry)]))
    }
    if (value.type === 'date') return new Date(value.value)
    return adapter.restore?.(value) ?? new PortableFirestoreValue(value)
  }
  return visit(wire)
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  const result = JSON.stringify(value)
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Valor JSON no canónico.')
  return result
}

export async function hashValue(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
