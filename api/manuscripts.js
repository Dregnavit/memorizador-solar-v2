import { serverFirebase, authenticate } from '../server/firebase.js'
import { preview, startDeletion, stepDeletion, cancelDeletion } from '../server/manuscripts/service.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Utiliza POST.' })
  if (process.env.SOLAR_ADMIN_DELETION_ENABLED !== 'true') return res.status(503).json({ error: 'La eliminación definitiva requiere habilitar el servicio administrativo después de revisar sus permisos y reglas. Archivar sigue disponible.' })
  try {
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 8000) return res.status(413).json({ error: 'Petición demasiado grande.' })
    const { db, auth, projectId } = serverFirebase()
    const uid = await authenticate(req, auth, projectId)
    const { action, sourceId, fingerprint, requestId, jobId } = req.body || {}
    let result
    if (action === 'preview') result = await preview(db, uid, sourceId)
    else if (action === 'start') result = await startDeletion(db, uid, sourceId, fingerprint, requestId)
    else if (action === 'step') result = await stepDeletion(db, uid, jobId)
    else if (action === 'cancel') result = await cancelDeletion(db, uid, jobId)
    else return res.status(400).json({ error: 'Operación no reconocida.' })
    return res.status(200).json(result)
  } catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'No se completó la operación administrativa. El trabajo puede reanudarse; consulta los registros del servidor.' }) }
}
