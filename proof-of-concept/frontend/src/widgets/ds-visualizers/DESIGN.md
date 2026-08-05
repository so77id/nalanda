# ds-visualizers — diseño

Documento de dirección para los widgets de visualización de EDAs. No es
prescriptivo — es un mapa para no perder el hilo entre sesiones.

## Principio central

Cada estructura de datos tiene **operaciones distintas**:

- Linked list → `push_front`, `push_back`, `remove_at`
- BST → `insert`, `delete`, rotaciones
- Heap → `push`, `pop_min`
- Grafo → `add_edge`, `BFS`, `DFS`

**No forzamos una interfaz única.** Cada visualizer es un componente React
autónomo con los props que su EDA necesita. Intentar unificar el API de
`<LinkedListViz>` y `<BSTViz>` produce una abstracción retorcida que no
vale la pena.

Lo que sí compartimos: chrome visual, primitivas de animación, layouts.
**La abstracción emerge de ejemplos concretos**, no se diseña up-front.

## Lo que hoy vive en común

- **`<VizFrame>`** — marco exterior con borde, label, contador `count/max`,
  banner de error
- **`<VizBody>`** — área de contenido con padding y fondo consistentes
- **`<VizControls>`** — fila de inputs + botones abajo, con estilo uniforme

Cada DS compone estos tres y dentro de `VizBody` renderiza su estructura
con Framer Motion.

## Lo que probablemente se sume (cuando haga falta)

- **`<Node>` primitivo** — caja con valor, animación de entrada/salida,
  colores. Extraer cuando 2+ DSes lo pidan.
- **Layouts**:
  - `linear` — fila horizontal (array, linked list)
  - `stack` — columna vertical (stack, queue vertical)
  - `tree` — jerárquico (BST, heap, trie)
  - `grid` — matriz de celdas (hash table, 2D array)
  - `graph` — layout por fuerza (grafos generales)
- **`useOperationLog`** — hook que registra la historia de operaciones
  (`push_front(9)`, `remove(1)`) y la muestra como timeline abajo del viz.
  Pedagógicamente fuerte.
- **`<HighlightPulse>`** — animación para "así se recorre": un nodo
  pulsa brevemente. Útil para mostrar BFS, DFS, búsqueda, recursión.

## Lo que NO se abstrae

- La lógica específica de cada operación (`push_front` ≠ BST `insert`)
- El set de props de cada componente
- Animaciones especializadas (rotaciones AVL, rebalanceo, compacción)

## Convención de carpetas

```
src/widgets/ds-visualizers/
├── VizFrame.jsx               # chrome compartido
├── index.js                   # barrel export
├── DESIGN.md                  # este documento
├── linked-list/
│   └── LinkedListViz.jsx
├── stack/
│   └── StackViz.jsx
├── queue/                     # (futuro)
├── bst/                       # (futuro)
├── heap/                      # (futuro)
├── hash-table/                # (futuro)
└── graph/                     # (futuro)
```

Una carpeta por estructura, aunque hoy solo tenga un archivo — deja
espacio para sus helpers (layout, algoritmos, variantes) sin reorganizar.

## Roadmap

1. **Lineales** ✅ LinkedList, ✅ Stack · → Queue, Deque, Array
2. **Árboles** — BST → Heap → AVL → Trie. Introduce layout jerárquico,
   probablemente fuerza `<Node>` primitivo y un helper de posicionamiento.
3. **Tablas hash** — celdas con bucketing. Layout grid.
4. **Grafos** — layout libre. Candidato para D3 force simulation.
5. **Algoritmos sobre estructuras** — modo paso a paso (BFS, DFS,
   Dijkstra, sort). Probablemente aparece `useOperationLog` /
   `usePlayback`.

Después de 3-4 EDAs hacer un pase de refactor extrayendo los patterns
reales que surgieron.

## Ideas abiertas (ver también IMPROVEMENTS.md del code-runner)

- **Interop con `<CodeRunner>`**: el student escribe
  `list.push_front(5)` en C++/Python y el viz anima la operación. Muy
  potente pedagógicamente pero requiere un protocolo (cómo el código
  reporta operaciones — ¿librería embebida en el runtime que imprime
  marcadores a stdout?). Dejado explícitamente fuera del MVP.
- **Modo "playback"**: cola de operaciones con tempo ajustable, reproduce
  automáticamente (ideal para presentación en vivo).
- **Modo "comparar"**: dos vistas lado a lado — ej. misma secuencia
  insertada en linked list y array, para mostrar costos distintos.
- **Mini-benchmarks**: contador de operaciones/comparaciones por op,
  para visualizar complejidad.
