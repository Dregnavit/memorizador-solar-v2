import { useId } from 'react'
import { helpFor, STEP_GUIDES } from './catalog.js'
import { useGuidance } from './GuidanceProvider.jsx'

export default function ContextHelp({ topic, context, descriptionId }) {
  const { mode } = useGuidance()
  const help = helpFor(topic, context)
  const uniqueId = useId()
  const id = descriptionId ?? `guidance-${uniqueId}`
  return <div className={`context-help context-help-${mode}`} data-guidance data-help-topic={topic}>
    <p id={id} aria-live={help.selection ? 'polite' : undefined} aria-atomic={help.selection ? 'true' : undefined} className={mode === 'guided' ? 'guidance-brief' : 'sr-only'}>{help.selection || help.instruction}</p>
    <details><summary>Ayuda: {help.title}</summary><dl className="guidance-details">
      {[['Qué significa', help.meaning], ['Para qué sirve', help.purpose], ['Qué hacer', help.instruction], ['Ejemplo práctico', help.example], ['Cuándo usarlo', help.when], ['Si lo omites o cambias', help.empty]].map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
    </dl></details>
  </div>
}

export function GuidedStep({ step }) {
  const { mode } = useGuidance()
  const guide = STEP_GUIDES[step]
  if (mode !== 'guided' || !guide) return null
  return <aside className="guidance-step" aria-label={`Orientación de la estación ${step + 1}`} data-guidance><h3>{guide[0]}</h3><p>{guide[1]}</p><details><summary>Ver un ejemplo y el criterio para avanzar</summary><p><strong>Ejemplo:</strong> {guide[2]}</p><p><strong>Para avanzar:</strong> {guide[3]}</p></details></aside>
}
