# Método Ícaro: diagnóstico y arquitectura de destino

## Auditoría verificada

La base de esta evolución es el commit `117a160a04c0ffe20cdef5fb8f23c3d428404d8e`. El repositorio contenía 22 archivos versionados, React 18.3.1, Firebase 10.14.1 modular, Vite 8.3.4, JavaScript/JSX, CSS y siete pruebas del dominio clásico. Se leyó íntegramente `Proyecto_Icaro_Blueprint.md` (996 líneas), contrastado con el PDF suministrado. Las propuestas del documento se consideran especificaciones y recomendaciones; las instrucciones expresas del propietario prevalecen.

| Área | Implementación de partida | Decisión |
| --- | --- | --- |
| Autenticación | `firebase.js`, `Auth.jsx`, `onAuthStateChanged` en `App.jsx`; Email/Password | Reutilizar, sin cambiar proyecto ni cuentas. |
| Navegación y temas | Estado condicional en `App.jsx`; medieval, claro, oscuro; CSS puro | Conservar, cargar nuevas pantallas por separado. |
| Biblioteca | `Dashboard.jsx` y colección raíz `texts`, filtro por `userId` | Mantener el acceso clásico; añadir fuentes y unidades privadas versionadas. |
| Fragmentación | Versos por saltos; prosa por fin de oración; `chunk_n` local a cada texto | Preservar fragmentos existentes; proponer cortes corregibles y offsets exactos en el nuevo flujo. |
| Lectura | `TextDetail.jsx`, `rawText` íntegro y progreso en tiempo real | Mantener para legado; reutilizar patrones visuales y de lectura. |
| Estudio | `StudyFlow.jsx`, revelado y cuatro notas, `writeBatch` por fragmento | Conservar como modo clásico; nuevo flujo de recuperación con estados y pistas. |
| Programación | Fórmulas especificadas originalmente; Good usa factor fijo 2,5 | Nombrar `legacy-v1`, sin presentar como SM-2 canónico ni convertir ease a FSRS. |
| Datos | `texts/{id}/progress/{chunkId}` con interval/ease/nextReview | No sobrescribir ni borrar durante la evolución. |
| Assets | No se encontraron la fuente gótica ni el PNG originales en `public/` | Conservar Georgia y emblema SVG de respaldo; informar del asset pendiente. |

El sistema anterior no representaba conceptos, premisas, escenas mnemónicas, lugares, encodings ni objetivos independientes. Mostrar una respuesta y calificarse no garantiza recuperación conceptual. Esas diferencias requieren lógica de dominio nueva, conservando los componentes útiles.

## Arquitectura de destino

- `packages/icarus-domain`: contratos Zod, segmentación, scheduler legado, codec y migración; posteriormente gates completos, máquina de recuperación y adaptador FSRS fijado a una versión verificada.
- `src/data/firestore`: servicios del SDK modular, transacciones, consultas y respaldo; ninguna credencial Admin en el navegador.
- `src/data/hooks`: suscripciones y estados de carga/error, independientes de la presentación.
- `src/features/preparation`: inventario propio, verificación y simulación local.
- `src/features/spaces`: palacios, macro-estaciones, loci y recorrido jerárquico.
- `src/features/library`, `encoding`, `review`: siguientes módulos de ingesta, Taller y repaso.
- `firestore.rules` e índices: frontera de acceso y comprobaciones atómicas compatibles con Spark.

Las entidades son colecciones hermanas bajo `users/{uid}`. Un locus es una micro-estación, no otra capa. La identidad usa IDs estables; el ordinal expresa orden. La fuente y su revisión conservan el texto; la unidad señala una porción exacta; el concepto expresa su significado; el encoding enlaza concepto, escena y lugar; cada tarjeta programa un objetivo concreto. Concepto, explicación y literalidad tendrán agendas distintas. Para poesía podrá elegirse interpretación conceptual, recitación o ambas.

## Fases y criterios de aceptación

| Hito | Dependencias | Entrega y aceptación | Estado |
| --- | --- | --- | --- |
| 1A: preservación | Auditoría y Blueprint | Contratos versionados, respaldo tipado con hashes, plan determinista, simulación con interrupción/reanudación y restauración local; cero modificaciones del legado y cero duplicados al repetir. | Implementado y probado localmente. |
| 1B: espacios | 1A y decisión Spark | Jerarquía persistente, loci con anclaje y señales sensoriales, IDs estables, archivado/restauración, versiones e historial; contadores concurrentes correctos, propiedad y relaciones protegidas por reglas. | Implementado; validación en emuladores. |
| 1C: biblioteca y Taller | 1A, 1B | Fuentes/revisiones, cortes revisables, concepto lógico/interpretativo, vínculos, escena, correspondencia y prueba de entrada aprobada. Publicación atómica de encoding, ocupación y tarjetas; ninguna tarjeta Ícaro sin gate aprobado. | Pendiente. |
| 1D: recuperación | 1C | Intento antes de revelar, pistas escalonadas con topes de nota, concepto/explicación/literalidad diferenciados; FSRS con estado completo, eventos inmutables e IDs idempotentes. | Pendiente. |
| 1E: operación | 1C, 1D | Prueba integral de prosa y poesía, accesibilidad, seguridad y límites Spark; migración real solo tras respaldo consistente, restauración comprobada y ensayo. | Pendiente. |
| 2: mapas/atrios | MVP funcional | Rutas editables, relaciones bidireccionales y variaciones reversibles; medir utilidad e interferencias. | Posterior. |
| 3–4: asistencia y optimización | Datos suficientes | Transferencia, asistencia semántica opcional, offline reconciliado, ajuste FSRS y experimentos. | Posterior. |

## Riesgos y decisiones abiertas

La adaptación de la frontera de confianza se recoge en [ADR Spark](ADR-spark.md). Las reglas no podrán demostrar la corrección de FSRS ni evaluar la verdad de una explicación. El aprendizaje se registra como autorreporte personal, sin rankings o promesas de certificación.

Una lectura paginada de una biblioteca activa no es una instantánea consistente. El respaldo actual se identifica como `uncoordinated` y solo habilita simulación. Falta implementar el protocolo de congelación temporal y recuperación antes de aplicar migraciones reales. Los fragmentos no trazables conservan su texto y requieren resolución humana; nunca reciben offsets inventados ni se convierten automáticamente en conceptos.

Las cuotas gratuitas limitan uso y tamaño, no la arquitectura. Las listas espaciales consultan páginas de 40 y desuscriben pantallas abandonadas. Las transacciones necesitan conexión. No se promete ocupación ni repaso confirmado offline.

La práctica de recuperación y el espaciamiento tienen apoyo experimental; el método de loci tiene evidencia con límites de generalización. La correspondencia primaria única, la escena propuesta, los descansos, los topes y políticas contra interferencias son decisiones de producto configurables, no leyes neuropsicológicas. Los atrios combinatorios requieren evaluación antes de afirmar una mejora.
