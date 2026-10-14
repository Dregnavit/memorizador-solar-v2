# Entrega 1: Modo Guiado integral

Implementación funcional sobre el modelo existente. No incorpora archivado/eliminación de manuscritos ni el nuevo recorrido literal; esas entregas permanecen pendientes. Las denominaciones públicas anteriores se conservan hasta la fase prevista de nomenclatura.

## Qué puede probar el usuario

Después de iniciar sesión, el encabezado ofrece **Nivel de ayuda**:

- **Modo Guiado**, predeterminado sin una preferencia guardada: instrucciones breves por campo y una orientación por estación del Taller con ejemplo y criterio para avanzar.
- **Modo Normal**: presentación compacta, conservando todos los controles desplegables «Ayuda: …». No elimina campos, comprobaciones ni requisitos del Taller.

«Cómo funciona» abre en cualquier momento una introducción interactiva de siete pasos. Enseña palacios, macros, loci, manuscritos, objetivos, codificación y repaso. Cada paso incluye ejemplo, práctica mental y una comprobación opcional con respuesta explicada. Se puede avanzar, retroceder o salir con el botón o Escape. El foco vuelve al control de origen; si el banner desapareció, vuelve al selector de ayuda.

En móvil, el contenido del paso tiene su propia región desplazable por teclado o tacto; cerrar y avanzar permanecen visibles. El diálogo utiliza el tema activo y limita su ancho y alto a la pantalla.

La primera visita ofrece un banner con «Comenzar introducción» y «Saltar introducción». No abre un modal automáticamente ni impide usar la aplicación. Saltarla retira el banner, pero conserva «Cómo funciona» y la elección de modo. Terminarla o saltarla no completa ninguna estación del Taller.

La preferencia se conserva **por cuenta y por navegador**, en `localStorage`, con versión propia. No se sincroniza entre dispositivos. Otras pestañas de la misma cuenta reciben el cambio. Si el almacenamiento está bloqueado o lleno, aparece un aviso y la elección sigue funcionando durante la sesión. Una preferencia corrupta o de versión desconocida recupera los valores iniciales sin bloquear el estudio.

## Pedagogía integrada

Cada ayuda contiene significado, finalidad, acción concreta, ejemplo, cuándo utilizarla y consecuencia de omitir o cambiar la opción. Guiado muestra una instrucción corta; los seis apartados completos solo se despliegan a petición, para no convertir cada formulario en una página de lectura obligatoria.

El Taller conserva sus ocho estaciones. La orientación enseña a revisar una unidad coherente, elegir un objetivo, reformular el significado, construir un punto de partida o enlace, recorrer la arquitectura, imaginar una acción con correspondencia, distinguir escenas y comprobar la recuperación antes de publicar.

Se explican también las ramas:

- Fundacional significa punto de partida del recorrido, no verdad indiscutible. Marcarlo exige explicar por qué se parte de esa idea; desmarcarlo requiere concepto anterior revisado, enlace y justificación.
- Cada tipo de enlace tiene explicación y ejemplo propios. Se conserva la dirección nueva → anterior. Orden argumental exige describir el orden, sin presentarlo como causa o implicación.
- Argumento requiere premisas, conclusión y justificación. Las demás funciones del pasaje tienen explicaciones propias y no exigen esa estructura.
- Los objetivos muestran qué tarjetas se crearán. Se explica que la recitación exacta actual todavía requiere todo el Taller; no se anuncia como implementado el recorrido literal de una fase posterior.
- Los loci ocupados, reservados, en descanso y archivados aparecen deshabilitados con su motivo. Una selección que pierde disponibilidad muestra un aviso; no se libera el lugar ni se sustituye el borrador. La validación transaccional de publicación sigue vigente.

La biblioteca nueva explica fuente, corte, preparación y tarjetas; sus cuatro campos de creación y la selección del manuscrito tienen ayuda. Los espacios explican jerarquía, nombre, anclaje, orden, señales sensoriales y archivados. También se orienta la biblioteca clásica, su formulario/lectura/estudio y la preparación del legado, incluidos sus límites de simulación.

## Ayuda durante los repasos

Se explica qué intentar en cada fase, cuándo pedir pistas, qué significa No recuerdo y cómo contrastar antes de calificar. Las cuatro notas describen el intento anterior a revelar. Se explica que las agendas dependen del historial y que concepto, explicación y recitación tienen estados independientes; no se prometen intervalos fijos ni certificación de comprensión.

Las comprobaciones y el consentimiento de guardar respuestas tienen ayuda propia. La ayuda general utiliza contenido pedagógico fijo: no recibe ni interpola la respuesta esperada, la escena particular o el texto privado del usuario. Pedir una pista real sigue usando el flujo existente y sus topes. Abrir una explicación general no aumenta el nivel de pistas ni realiza un autorreporte.

Los atajos de estudio ignoran diálogos, resúmenes desplegables y controles de orientación. Así, Enter/Espacio pueden abrir una ayuda y las teclas 1–4 en la introducción no califican una tarjeta que esté detrás.

## Datos, seguridad y despliegue

La implementación no cambia servicios de escritura, gates, contratos, FSRS, reglas, índices ni datos de Firebase. No añade dependencias. Cambiar el nivel de ayuda no remonta el recorrido ni envía actualizaciones al borrador; los ejemplos nunca se insertan en los campos. El provider se identifica por UID para separar preferencias al cambiar de cuenta.

**Basta con desplegar la nueva versión del frontend en Vercel.** No hay variables nuevas, despliegue de reglas o índices ni migración para esta entrega. Los flags existentes siguen controlando el acceso a biblioteca/Taller y espacios; no se cambian sus nombres o valores. Esto no sustituye los índices y reglas que la aplicación ya necesitaba antes de esta entrega.

## Componentes y archivos

| Archivos | Responsabilidad |
| --- | --- |
| `src/features/guidance/preferences.js` | Lectura/escritura defensiva de preferencias versionadas, separadas por UID. |
| `src/features/guidance/catalog.js` | Ayuda completa de campos, ramas condicionales y criterios de las ocho estaciones. |
| `src/features/guidance/GuidanceProvider.jsx` | Contexto de presentación, controles, bienvenida, persistencia y sincronización entre pestañas. |
| `src/features/guidance/Introduction.jsx` | Recorrido interactivo, ejercicios, navegación, Escape y gestión de foco. |
| `src/features/guidance/ContextHelp.jsx` | Ayuda con divulgación progresiva y orientación de cada estación. |
| `src/App.jsx`, `src/App.css` | Integración por cuenta y estilos legibles/responsive para los tres temas. |
| `EncodingWorkshop.jsx` | Ayudas en todos los campos y ramas, criterios por estación y explicación de disponibilidad de loci. |
| `CognitiveLibrary.jsx`, `PalaceExplorer.jsx` | Orientación de archivo, creación, selección, jerarquía y gestión espacial existente. |
| `SteppedReview.jsx`, `StudyFlow.jsx` | Ayuda de recuperación/nota y protección de atajos dentro de controles y diálogos. |
| `Dashboard.jsx`, `TextDetail.jsx`, `IcarusPreparation.jsx` | Ayuda en los flujos clásicos y de preparación existentes. |
| `tests/unit/guidance.test.js` | Persistencia, fallos de almacenamiento, cobertura de campos/opciones y ausencia de interpolación de respuestas privadas. |
| `tests/e2e-guidance.mjs`, `package.json` | Recorrido Chromium de la nueva experiencia; comando `npm run test:e2e:guidance`. |

## Verificación

`npm test` incluye seis regresiones nuevas. `npm run test:e2e:guidance`, con los emuladores y Vite demo existentes, comprueba introducción, ejercicios, retroceso, salida/reapertura y foco; modos y persistencia por cuenta; almacenamiento bloqueado; ayuda de seis apartados; ramas de argumento/fundamento/enlaces; gates preservados; borrador e intento conservados; ausencia de escritura de borrador por cambiar de modo; loci ocupados; ausencia de respuesta privada en la ayuda; notas/atajos protegidos; tres temas y móvil.

Esta suite solo registra datos ficticios en `demo-memorizador-solar`, después de comprobar el proyecto y emulador de Auth. Usa las reglas reales del repositorio y las APIs existentes para preparar sus fixtures. No ejecutarla simultáneamente con suites que cambien reglas o limpien la base demo.

Verificación realizada en esta entrega: **50 pruebas unitarias y 21 pruebas de Rules/consultas aprobadas**. Pasaron `test:e2e:guidance`, `test:e2e` (incluyendo espacios y preparación), `test:e2e:cognitive` y `test:e2e:firestore`, además de lint y build. La regresión nueva comprueba también sincronización entre pestañas y referencias ARIA sin IDs duplicados o destinos inexistentes. Se revisó visualmente la introducción en móvil con temas medieval y oscuro. El build conserva el aviso de Vite de un chunk superior a 500 kB; no impide compilar y no se ha ocultado ajustando el umbral.
