# ds-visualizers — Mejoras pendientes

Backlog tactico para los widgets de visualización. Complementa `DESIGN.md`
(que define el rumbo filosófico) con items concretos que ya discutimos
pero diferimos.

## Widgets por construir

### Familia lineal (completar)
- **`DequeViz`** — double-ended queue. Combina operaciones de stack y
  queue. Trivial después de los dos.
- **`ArrayViz`** — fixed-size array con índices visibles. Ops: set/get/
  shift/unshift con costos visibles. Útil para contrastar con linked list.
  - _Estado actual_: construido con `push` + `arr[i]` (access con
    highlight). Falta `set(i, v)`, `shift`/`unshift`, costos visibles.

### Familia árbol
- **`HeapViz`** — binary heap (min/max). Layout jerárquico igual que BST
  pero con invariante distinta. Primer candidato fuerte para extraer
  `layouts/tree.js`.
  - _Estado actual_: construido e interactivo (`insertar` +
    `extraer-min|max` con sift-up/down animados).
- **`AVLViz`** — self-balancing. Animar rotaciones es el diferencial
  pedagógico — poder mostrar una rotación left/right step-by-step.
- **`TrieViz`** — árbol con letras. Útil para autocomplete, prefix
  matching. Nodos con multiple children → layout similar a tree pero
  con branching factor >2.
- **`RedBlackViz`** — colores en los nodos, rebalanceo más complejo.
  Tier 2.

### Familia tabla/grid
- **`HashTableViz`** — bucket array con chaining (linked list por bucket)
  o open addressing. Layout `grid` nuevo. Ver colisiones es el punto
  fuerte.
  - _Estado actual_: construido como `HashMapViz` con separate chaining,
    **modo display estático** — recibe `buckets` ya computados por prop.
    Falta capa interactiva:
    - `put(key, value)` con función de hash visible (ej: `hash(k) = sum(chars) % size`).
    - `get(key)` que anima el camino: bucket → entrada por entrada hasta encontrar/no encontrar.
    - `delete(key)` con highlight del removido antes del exit.
    - Resize / rehash al pasar cierto load factor (`size * 2` y redistribuir).
    - Variante open addressing con linear/quadratic probing.
- **`Matrix2DViz`** — grid básico para introducir 2D.

### Familia grafo
- **`GraphViz`** — layout por fuerza (D3-force). El más complejo.
  Versiones: undirected/directed, weighted. Ops: add_node, add_edge,
  remove_edge.
  - _Estado actual_: construido con layout circular (≤12 nodos),
    **modo display estático** — recibe `nodes`/`edges` por prop y los
    dibuja. Falta capa interactiva:
    - `add_node(id, label?)` / `remove_node(id)`
    - `add_edge(from, to, weight?, directed?)` / `remove_edge(i)`
    - Toggle global `dirigido` en el footer.
    - Para layout real se sigue dependiendo de force (diferido).
- **`GridGraphViz`** — grafo con layout de cuadrícula, útil para maze
  solving, A*.

## Features cross-widget

Ideas que aplican a casi cualquier viz:

### Operation log / history
Hook `useOperationLog` que registra cada operación (`push_front(9)`,
`insert(5)`, `delete_root`) y las muestra como timeline abajo del
viz. Muy valioso pedagógicamente: el estudiante ve el historial,
puede "deshacer" navegando al paso anterior.

### Playback mode
Cola de operaciones con tempo ajustable. Dado un array de ops
(cargado del profe o generado por el student), reproducirlas
automáticamente con pausa/play/siguiente/tempo-slider. Ideal para
presentación en vivo.

### Modo comparación
Dos vizzes lado a lado mostrando la misma secuencia sobre EDAs
distintas (ej: 10000 inserts random en linked list vs array — ver el
costo comparativo). Requiere coordinar operaciones.

### Search highlight
Pasar una función `<DS>.search(v)` que retorne el camino recorrido.
El viz anima: primero resalta el nodo actual, luego salta al
siguiente, etc. Para BST mostrá cómo "baja" el algoritmo.

### Algorithm step-through
Modo paso a paso para algoritmos específicos:
- BFS / DFS en grafo (visited set, frontier, current node)
- Dijkstra (distancias tentativas, nodo actual)
- Sorting (bubble/merge/quick — swaps resaltados)
- In-order / pre-order / post-order traversal de árbol

### Interop con `<CodeRunner>`
El santo grial, de alto riesgo: el student escribe código en el
runner, el código ejecuta operaciones sobre la EDA, y el viz se
anima con cada op. Opciones:

- **A. stdout markers**: código imprime `@VIZ[push_front(5)]` y un
  parser los captura → anima. Simple pero frágil.
- **B. Biblioteca embebida**: se provee al student una clase
  instrumentada (ej: `NalandaList`) que reporta ops por side-channel
  (WebAssembly imports, o stdout estructurado).
- **C. Source transformation**: reescribir el código del student
  antes de compilar, inyectando llamadas al tracer.

Fuera del MVP, pero escribir esto acá para no perder el concepto.

### Mini-benchmarks
Contador de ops/comparaciones por operación. Ej: en BST, mostrar
"insert 5: 3 comparisons" para que el student vea empíricamente la
complejidad.

### Fullscreen toggle
Como tiene el `<CodeRunner>`. Permite al profe proyectar un viz a
pantalla completa durante la clase.

### Reset
Botón para volver a los `initialValues`. Hoy `clear` solo vacía.

### Export / import
- Export: serializar el estado como string/JSON para compartir.
- Import: cargar desde ese string. Útil para que el profe prepare
  casos específicos.

## Mejoras por widget

### LinkedListViz
- Variante doubly-linked (flechas en ambos sentidos)
- Variante circular (último apunta a primero)
- Insert at index (no solo front/back)
- Reverse animado
- Hover sobre nodo → resaltar predecessor/successor

### StackViz
- Operación `peek` que resalta el top brevemente sin mutar

### QueueViz
- Operación `peek` igual
- Variante circular buffer con tamaño fijo

### BSTViz
- Mostrar la regla de invariante visualmente: al hover sobre un
  nodo, resaltar en verde los que deberían ser menores, en rojo los
  que deberían ser mayores.
- Traversals animados (in-order, pre-order, post-order, BFS)
- Balancing factor por nodo
- Height del árbol como badge
- Modo "árbol degenerado" vs "balanceado" — seed distintos para
  contrastar.

## Patterns a extraer (cuando aparezcan 5+ widgets)

Al escribir los próximos 1-2 widgets, probablemente aparezcan estas
extracciones de forma natural:

- **`useVizState({ initialValues, maxNodes, parseValue, errorMessages })`**
  — encapsula `useState` del input, error, nextId, checks comunes
  (parseInt, duplicates, capacity).
- **`<Node>` primitivo** — la caja con valor, animación spring
  consistente, variantes de color por estado (normal / highlighted /
  exiting).
- **`<Edge>` primitivo** — SVG line con strokeWidth consistente,
  animable.
- **`layouts/linear.js`** — devuelve posiciones horizontales para
  listas/stacks/queues.
- **`layouts/tree.js`** — in-order x + depth y + edge collection.
  Reusable entre BST, heap, AVL, trie.
- **`layouts/grid.js`** — celdas en matriz, para hash tables.
- **`layouts/force.js`** — wrapper de D3-force para grafos.
- **Constantes de animación compartidas**
  (`SPRING = { type: 'spring', stiffness: 420, damping: 32 }`).

No extraer antes de tener los casos que lo justifiquen. Extraer
tarde es fácil; deshacer una abstracción mal hecha es caro.

## Estética (diferido, ver también code-runner/IMPROVEMENTS.md)

- Tema light + respeto de `prefers-color-scheme`
- Paleta más lúdica (Crafting Interpreters-style) en vez de slate+fuchsia
- Tipografía más expresiva para los valores
- Sonidos sutiles en inserts/deletes (opcional, togglable)
- Modo "dibujo a mano" (rough.js) para dar vibe de pizarra
