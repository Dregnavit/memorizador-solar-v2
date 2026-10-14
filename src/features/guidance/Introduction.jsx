import { useEffect, useRef, useState } from 'react'

export const INTRODUCTION = [
  { title: 'Un palacio es un escenario familiar', text: 'Elige un lugar que puedas recorrer de forma estable, real o imaginado. Su utilidad está en reconocer sus lugares y volver a ellos mentalmente; no hace falta un edificio grandioso.', example: 'La casa de tu infancia sirve si puedes imaginar su entrada y sus habitaciones.', task: 'Cierra los ojos un instante y busca una entrada reconocible.', question: '¿Cuál es un buen comienzo?', choices: ['Una casa que puedo recorrer mentalmente', 'Un nombre impresionante que no puedo imaginar'], answer: 0, feedback: 'La familiaridad y un recorrido reconocible te dan un punto de partida concreto.' },
  { title: 'Las macro-estaciones organizan el recorrido', text: 'Una macro-estación es una sala, patio o tramo dentro del palacio. Ayuda a reunir lugares que reconoces como una misma zona.', example: 'Casa → cocina. La cocina es la macro; todavía no es el anclaje concreto de una escena.', task: 'Imagina pasar de la entrada a una habitación en un orden que puedas repetir.', question: 'Dentro de una casa, ¿qué puede ser una macro?', choices: ['La cocina', 'Toda la casa por segunda vez'], answer: 0, feedback: 'Una zona diferenciada permite ordenar varios anclajes sin confundir niveles.' },
  { title: 'Un locus es un punto concreto', text: 'Locus significa lugar. Elige un punto que puedas distinguir de los vecinos. Una codificación activa ocupa ese lugar y no se sustituye por otra desde el Taller.', example: 'Casa → cocina → esquina izquierda de la mesa. Otros loci podrían ser el grifo y la ventana.', task: 'Identifica dos puntos distintos de la habitación y comprueba que no los intercambias.', question: '¿Cuál es el locus más concreto?', choices: ['La esquina izquierda de la mesa', 'Cualquier sitio de la casa'], answer: 0, feedback: 'La posición precisa te ayuda a recuperar la escena que realmente asociaste a ese anclaje.' },
  { title: 'El manuscrito conserva el original', text: 'Guarda el texto íntegro y revisa sus propuestas de corte. Una unidad es una porción que vas a preparar; seleccionar un corte no cambia el original ni publica tarjetas.', example: 'Puedes guardar un poema completo y preparar una estrofa, o seleccionar dos frases que forman un razonamiento.', task: 'Piensa qué corte conservaría una idea completa, sin aislar una conclusión de sus razones.', question: '¿Qué hace Preparar unidad?', choices: ['Abre la preparación de ese corte', 'Sustituye el original por un resumen'], answer: 0, feedback: 'La fuente sigue íntegra. El corte entra al Taller y aún necesita preparación antes de generar tarjetas.' },
  { title: 'Comprender y recitar son objetivos diferentes', text: 'Comprender permite explicar con tus palabras; recitar exige reproducir el texto. El objetivo combinado mantiene ambas prácticas y sus agendas por separado.', example: 'Explicar una definición sin copiarla puede ser correcto conceptualmente. Recitar un himno requiere conservar su formulación.', task: 'Decide qué querrías poder hacer sin mirar: explicar, repetir exactamente o ambas cosas.', question: '¿Una buena paráfrasis prueba recitación exacta?', choices: ['No; muestra un objetivo distinto', 'Sí, si expresa aproximadamente lo mismo'], answer: 0, feedback: 'Los objetivos se separan. En esta versión la recitación exacta aún se prepara mediante todo el Taller; el recorrido literal independiente vendrá después.' },
  { title: 'Codificar conecta significado, imagen y lugar', text: 'El Taller te pide entender una idea, situarla en tu recorrido y crear una escena cuya acción represente el significado. La correspondencia explica ese puente. El examen de entrada comprueba tu propio recuerdo antes de publicar.', example: 'Una semilla recoge agua con un paraguas en la fuente del patio. Debes explicar qué representa cada elemento y luego evocarlo sin mirar.', task: 'Imagina una acción y pregúntate si podrías volver desde ella al significado, sin leer tu explicación.', question: '¿Qué hace útil la imagen?', choices: ['Puedo explicar qué significa y recuperarla en su lugar', 'Tiene muchos detalles, aunque no se relacionen con la idea'], answer: 0, feedback: 'No basta con un dibujo llamativo: ensaya la asociación y comprueba si conduce al significado. La aplicación no certifica comprensión por completar casillas.' },
  { title: 'Repasar es intentar antes de revelar', text: 'La agenda propone cuándo volver. Primero recuperas, después contrastas y finalmente calificas el intento. Las pistas quedan registradas y limitan la nota; reconocer la solución no equivale a haberla recordado.', example: 'Repetir: fallo. Difícil: correcto con esfuerzo. Bueno: correcto y razonablemente fluido. Fácil: autónomo y fluido. Cada objetivo conserva su historial.', task: 'Antes del próximo repaso, comprométete a intentar una respuesta sin consultar la solución.', question: 'Si solo lo reconociste al revelar, ¿qué corresponde?', choices: ['Repetir', 'Fácil porque ahora resulta evidente'], answer: 0, feedback: 'El fallo informa a la agenda. Los intervalos dependen del historial; el espaciamiento y las imágenes no garantizan por sí solos un aprendizaje perfecto.' },
]

export default function Introduction({ onClose, onComplete }) {
  const dialog = useRef(null)
  const heading = useRef(null)
  const body = useRef(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const step = INTRODUCTION[index]
  const choice = answers[index]
  useEffect(() => {
    const node = dialog.current
    const previousFocus = document.activeElement
    node?.showModal()
    heading.current?.focus()
    return () => { node?.close(); if (previousFocus?.isConnected) previousFocus.focus(); else document.getElementById('guidance-level')?.focus() }
  }, [])
  useEffect(() => { heading.current?.focus(); if (body.current) body.current.scrollTop = 0 }, [index])
  return <dialog ref={dialog} className="modal card guidance-introduction" aria-labelledby="guidance-intro-title" data-guidance onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="guidance-intro-heading"><div className="guidance-intro-top"><p className="eyebrow">Bienvenida · Paso {index + 1} de {INTRODUCTION.length}</p><button className="button button-quiet" type="button" aria-label="Salir de la introducción" onClick={onClose}>Cerrar</button></div>
    <h2 id="guidance-intro-title" ref={heading} tabIndex={-1}>{step.title}</h2>
    <progress value={index + 1} max={INTRODUCTION.length} aria-label={`Paso ${index + 1} de ${INTRODUCTION.length}`} /></div>
    <div className="guidance-intro-body" ref={body} role="region" aria-label="Contenido del paso" tabIndex={0}>
    <p>{step.text}</p><div className="guidance-example"><strong>Ejemplo</strong><p>{step.example}</p></div>
    <p><strong>Prueba mental:</strong> {step.task}</p>
    <fieldset className="guidance-exercise"><legend>{step.question}</legend>{step.choices.map((text, option) => <label key={text}><input type="radio" name={`introduction-${index}`} checked={choice === option} onChange={() => setAnswers((current) => ({ ...current, [index]: option }))} />{text}</label>)}</fieldset>
    {choice !== undefined && <p role="status">{choice === step.answer ? 'Así es. ' : 'Vuelve a considerar el ejemplo. '}{step.feedback}</p>}
    <p className="field-help">La comprobación es opcional: no califica tu aprendizaje ni modifica tus manuscritos. Puedes salir y volver desde «Cómo funciona».</p>
    </div>
    <div className="actions guidance-intro-actions"><button className="button button-secondary" type="button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Paso anterior</button>{index + 1 < INTRODUCTION.length ? <button className="button" type="button" onClick={() => setIndex((value) => value + 1)}>Siguiente paso</button> : <button className="button" type="button" onClick={onComplete}>Terminar introducción</button>}</div>
  </dialog>
}
