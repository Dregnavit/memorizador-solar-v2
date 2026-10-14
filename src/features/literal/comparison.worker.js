import { compareLiteral } from '@icarus/domain/literal'
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: compareLiteral(data.original, data.attempt, data.profile, { language: data.language }) }) }
  catch (error) { self.postMessage({ error: error.message }) }
}
