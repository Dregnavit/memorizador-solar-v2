export default function ReadNotice({ data, loadingText = 'Leyendo el archivo…' }) {
  if (data.loading) return <p role="status">{loadingText}</p>
  if (data.status === 'unconfirmed') return <p className="notice" role="status">Esperando confirmación de Firestore. Los datos locales todavía no permiten determinar los pendientes.</p>
  if (!data.error) return null
  return <div className="notice notice-error" role="alert">
    <p>{data.error}</p>
    {data.diagnostic && <details><summary>Detalle de Firebase: <code>{data.diagnostic.code}</code></summary>
      <p>Proyecto: <code>{data.diagnostic.projectId}</code> · Colección: <code>{data.diagnostic.collection}</code> · Consulta: <code>{data.diagnostic.queryName}</code></p>
      <pre className="read-error-detail">{data.diagnostic.originalMessage || 'El SDK no proporcionó un mensaje adicional.'}</pre>
    </details>}
    <button className="button button-secondary" type="button" onClick={data.retry}>Reintentar lectura</button>
  </div>
}
