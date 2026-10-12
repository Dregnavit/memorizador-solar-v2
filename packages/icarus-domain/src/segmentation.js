export function proposeSegments(originalText, mode = 'sentences') {
  if (typeof originalText !== 'string') throw new TypeError('La fuente debe ser un texto.')
  const separators = { sentences: /(?<=[.!?])\s+|\n+/g, verses: /\n+/g, stanzas: /(?:\r?\n)[\t ]*(?:\r?\n)+/g }
  const separator = separators[mode]
  if (!separator) throw new TypeError('Modo de segmentación no válido.')
  const boundaries = []
  let cursor = 0
  for (const match of originalText.matchAll(separator)) {
    boundaries.push([cursor, match.index])
    cursor = match.index + match[0].length
  }
  boundaries.push([cursor, originalText.length])
  return boundaries.flatMap(([start, end]) => {
    const selection = originalText.slice(start, end)
    const text = selection.trim()
    if (!text) return []
    const startOffset = start + selection.length - selection.trimStart().length
    const endOffset = end - (selection.length - selection.trimEnd().length)
    return [{ text, startOffset, endOffset }]
  }).map((segment, ordinal) => ({ ...segment, ordinal }))
}

export function locateLegacyFragments(originalText, fragments) {
  if (typeof originalText !== 'string' || !Array.isArray(fragments)) throw new TypeError('Fuente o fragmentos no válidos.')
  let cursor = 0
  return fragments.map((fragment) => {
    const text = typeof fragment?.text === 'string' ? fragment.text : ''
    const start = text.trim() ? originalText.indexOf(text, cursor) : -1
    if (start < 0) return { startOffset: null, endOffset: null, traceStatus: 'unresolved' }
    cursor = start + text.length
    return { startOffset: start, endOffset: cursor, traceStatus: 'resolved' }
  })
}

export function assertExactSourceSlice(revision, unit) {
  if (unit?.traceStatus !== 'resolved' || typeof revision?.originalText !== 'string'
    || !Number.isSafeInteger(unit?.startOffset) || !Number.isSafeInteger(unit?.endOffset)
    || unit.startOffset < 0 || unit.endOffset <= unit.startOffset || unit.endOffset > revision.originalText.length
    || revision.originalText.slice(unit.startOffset, unit.endOffset) !== unit.text) {
    throw new Error('La unidad no coincide exactamente con su revisión fuente.')
  }
  return true
}
