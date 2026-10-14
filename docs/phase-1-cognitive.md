# Taller y Repaso Escalonado: MVP cognitivo

## Activar la interfaz

Publica primero `firestore.rules` y los cinco índices de `firestore.indexes.json`; espera a que estén listos. En Vite/Vercel añade `VITE_ICARUS_LEARNING_ENABLED=true` y recompila. Aparece «Estudiar», junto al acceso a los palacios. La preparación del legado mantiene su propio flag y sigue siendo de solo lectura. No se han desplegado reglas ni modificado datos del proyecto real durante la implementación.

El plan Spark usa exclusivamente React 18, JavaScript, Firebase 10 modular, Authentication y Firestore. No requiere Cloud Functions ni Blaze. Las reglas controlan propiedad, relaciones, estados, versiones, historiales, acoplamiento de escrituras y topes declarados; no convierten el navegador en un entorno confiable ni certifican comprensión. Consulta [ADR Spark](architecture/ADR-spark.md).

## Ingesta y Taller

Un manuscrito nuevo conserva su texto original íntegro en una revisión inmutable. Los cortes automáticos de oraciones, versos y estrofas son propuestas. Selecciona una propuesta o una porción del manuscrito con ratón/teclado para crear una unidad; el SDK valida que corresponde exactamente a su fuente y mantiene offsets UTF-16, incluidos emoji y CRLF. Repetir la misma selección utiliza el mismo ID. No se sobrescriben fuentes ni textos clásicos.

Cada unidad debe atravesar ocho estaciones: revisión del corte, lectura/objetivo, destilación, fundamentación/enlace, espacio, escena, correspondencia/discriminación y examen de entrada. Los borradores se guardan automáticamente tras una pausa y se pueden guardar al salir. Las versiones evitan sobrescribir cambios de otra pestaña. El examen se rehace al reabrir un borrador; sus respuestas permanecen en memoria y no se suben.

Un argumento requiere premisas, conclusión y justificación. Una interpretación poética no se fuerza a esa estructura. Una copia exacta del concepto exige reconocimiento explícito como cita indispensable. «Necesito investigar» bloquea el avance. Las aristas se leen desde la idea nueva hacia la anterior: «nueva depende de anterior», «nueva es ejemplo de anterior», etc. La escena necesita agente, acción, símbolo, rasgo distintivo, correspondencia y ensayo mental; la pregunta de recuperación debe evitar incluir la solución.

El examen recoge evocación de escena, significado y una relación/ejemplo antes de mostrar el material preparado. El usuario compara y confirma recuperación y ausencia de error esencial. Son comprobaciones de completitud y autorreporte; ni la longitud de una respuesta ni el clic de aprobación prueban su verdad.

Publicar lee el borrador y las referencias, verifica la versión y el locus libre y escribe atómicamente concepto, arista opcional, encoding, tarjetas, unidad lista, ocupación del locus e historial. No hay tarjetas activas publicadas a medias. Un encoding tiene un locus primario y la unidad conserva su identidad. El encoding publicado, el concepto y la arista son inmutables en este MVP; editar/reasignar exige un protocolo posterior de nuevas versiones y retiro explícito.

## Tres objetivos, tres agendas

| Objetivo elegido | Tarjetas |
| --- | --- |
| Comprender y explicar | Concepto + explicación |
| Recitación exacta | Verbatim |
| Comprender, explicar y recitar | Concepto + explicación + verbatim |

Cada tarjeta tiene estado FSRS completo, fecha de vencimiento y versión independientes. Fallar la recitación no borra el éxito conceptual. La lectura completa permanece disponible fuera de la sesión, y «Practicar todos los objetivos» permite una sesión adicional explícita.

FSRS se calcula con `ts-fsrs@5.4.2`, fijado en el lockfile. El codec 2 serializa tarjeta y parámetros completos como JSON tipado; evita los arrays anidados que Firestore no admite y restaura fechas exactamente. Conserva estabilidad, dificultad, reps, lapses, learning_steps, estado y last_review. Una versión desconocida se rechaza antes de sobrescribir. El scheduler legado permanece `legacy-v1`; ease e interval del legado no se convierten a FSRS.

Los valores actuales son defaults de producto: retención solicitada 0,9, intervalo máximo 36.500 días, pasos cortos habilitados y fuzz deshabilitado para reproducibilidad. Son parámetros de programación, no leyes sobre consolidación cerebral ni una predicción clínica individual. La personalización y optimización con datos suficientes se desarrollarán después.

## Recuperación graduada

Concepto y explicación recorren orientación → escena → significado → relación/ejemplo → contraste → nota. El objetivo literal recorre orientación → intento literal → contraste → nota. La tarjeta literal no exige aprobar una respuesta conceptual adicional. El original, el concepto esperado y la escena completa no se renderizan durante la evocación; aparecen tras los intentos o al declarar «No recuerdo».

Las pistas requieren un intento en el campo actual. H1 ofrece una clave sensorial general (tope Bueno), H2 agente/categoría (tope Difícil), H3 parte del concepto (Repetir). «No recuerdo» y un error esencial fuerzan Repetir, incluso si se marcan después las casillas de corrección. Difícil significa recuerdo exitoso con esfuerzo. La recitación exacta contrasta palabras, puntuación, espacios y saltos sin normalización; una diferencia impide marcar exactitud. Las respuestas conceptuales se calibran por checklist, sin comparación literal contra sinónimos.

Las teclas 1–4 actúan al calificar fuera de campos/botones; espacio/Enter pueden iniciar orientación. Los listeners se desmontan y no califican al escribir. Un fallo de red conserva el intento, la nota y el mismo ID en la tarjeta actual. La sesión no avanza hasta confirmar la transacción. No se promete una cola durable offline: cerrar o recargar mientras falla una escritura requiere abrir de nuevo la tarjeta.

## Historial, privacidad e integridad

La transacción de repaso actualiza la tarjeta y crea un evento append-only. El evento guarda versiones previa/nueva, agenda y snapshots FSRS antes/después, nota, ayuda declarada y metadatos de recuperación. Por defecto omite el texto de respuestas. Una casilla de consentimiento por tarjeta permite conservarlo en el namespace privado del propietario; otra cuenta no puede leerlo. Los eventos no se modifican ni eliminan.

Las reglas exigen el evento y la tarjeta simultáneos, rechazan versiones obsoletas, campos extra no autorizados y notas que exceden la ayuda declarada, y limitan el reloj a cinco minutos respecto de `request.time`. Los IDs estables y el hash de intención reconocen reintentos ya confirmados. No obstante, el cliente puede mentir sobre su esfuerzo, sus ayudas o el FSRS calculado: no hay un servidor que ejecute la biblioteca. Los offsets y hashes se comprueban en el dominio cliente; las reglas comprueban referencias y límites, sin implementar un algoritmo de slicing UTF-16 o SHA-256.

La publicación se ha ensayado con un argumento enlazado y tres objetivos para comprobar límites de expresiones/accesos de reglas. Las comprobaciones de campos inmutables no se duplican al actualizar: se protegen por la lista cerrada de campos modificables y validaciones recíprocas. No se abren escrituras generales de propietario.

## Pruebas y alcance restante

Ejecuta `npm test`, `npm run lint` y `npm run build`. Con Firestore demo local, `npm run test:rules` incluye publicación inválida directa, ocupación concurrente, argumento enlazado, eventos idempotentes, privacidad y topes de ayuda. Esa suite limpia solo `demo-memorizador-solar`; no ejecutarla junto con E2E.

Inicia Vite demo en 5181 con los tres flags activos y Auth/Firestore en 9099/8080. Ejecuta `E2E_BASE_URL=http://127.0.0.1:5181 E2E_REQUIRE_PREPARATION=true E2E_REQUIRE_SPACES=true npm run test:e2e` y `E2E_BASE_URL=http://127.0.0.1:5181 npm run test:e2e:cognitive`. Ambos verifican configuración demo antes de crear cuentas. El segundo recorre prosa argumental, poema por estrofas, Taller guardado/reanudado, examen, ayudas, olvido, error offline/reintento, agendas separadas, consentimiento y móvil.

La migración real del legado continúa deshabilitada hasta contar con snapshot consistente y restauración probada. Permanecen para fases posteriores: transferencias maduras y rutas sin locus, objetivos de relación/orden, editor de rutas y reasignación, atrios y ruedas combinatorias, ajuste personalizado de FSRS y sincronización offline reconciliada. El núcleo solicitado del Taller y el Repaso Escalonado ya está implementado; no se presenta como la totalidad de todas las extensiones del Blueprint.

La evolución posterior incorpora archivado y recorrido literal independiente; consulta la [guía actual de Memorizador Solar](learning-and-lifecycle.md) y sus requisitos de activación. Este documento conserva el alcance de la entrega histórica.
