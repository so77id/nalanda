# Nalanda — SPEC

> Plataforma interactiva de aprendizaje de CS, inspirada en la universidad
> budista de Nalanda (siglo V). Un solo sitio donde teoría, presentación,
> visualización y ejecución de código viven juntas.

## 1. Objetivo

Construir una plataforma de aprendizaje interactivo donde un profesor de CS
crea cursos que combinan teoría, presentaciones, visualizaciones interactivas
y ejecución de código en vivo — todo en el browser.

El MVP valida las **herramientas/widgets centrales** usando como banco de
pruebas un único curso: "Estructuras de Datos en C++". Se difiere
deliberadamente la plataforma como tal (auth, multi-tenancy, persistencia,
UI de autoría).

**Principio central:** la misma página sirve como material de auto-estudio
para el estudiante Y como material de presentación en vivo para el profesor.
No hay slide deck separado. Los widgets (ejecutor de código, visualizadores)
son usables tanto en estudio asíncrono como proyectados en clase.

**Criterios de éxito del MVP:**
- Código C++ compila y corre en el browser (sin backend)
- Al menos 3 visualizadores de DS funcionan (insert / delete / search animados)
- Al menos 1 visualizador de algoritmo (paso a paso)
- Una página del curso combina markdown teórico + widgets embebidos
- Un "modo presentación" hace la misma página proyectable para clase en vivo
- Deployable a GitHub Pages (100% estático)

**Visión a largo plazo (FUERA del MVP, registrada para contexto):**
- Plataforma multi-autor con UI web de autoría
- Navegación libre tipo grafo entre conceptos
- Cuentas de usuario, progreso, analytics
- Licenciamiento comercial a universidades

## 2. Commands

A poblar cuando el proyecto se inicialice:
- `npm run dev` — servidor de desarrollo (Vite)
- `npm run build` — build de producción a `dist/`
- `npm run preview` — sirve build localmente
- `npm run deploy` — deploy a GitHub Pages
- `npm test` — tests unitarios (Vitest)

## 3. Project Structure

```
/
├── src/
│   ├── widgets/              # Biblioteca central — cada widget independiente
│   │   ├── cpp-runner/       # Ejecución C++ (Emscripten/WASM)
│   │   ├── ds-visualizers/   # BST, linked list, heap, hash table, ...
│   │   ├── algo-visualizers/ # Sorting, búsquedas, BFS/DFS, ...
│   │   ├── quiz/             # Opción múltiple, drag-drop
│   │   └── slides/           # Primitivas del modo presentación
│   ├── course/
│   │   └── data-structures-cpp/
│   │       ├── 01-intro.mdx
│   │       ├── 02-arrays.mdx
│   │       └── ...
│   ├── shell/                # Layout, nav, routing mínimos
│   └── main.jsx
├── public/                   # Assets estáticos, artifacts WASM
├── experiments/              # Prototipos desechables para validar herramientas
└── SPEC.md
```

Contenido autorado en **MDX**. Los widgets se importan como componentes React
dentro de MDX: `<CppRunner />`, `<BSTVisualizer />`, etc.

## 4. Code Style

- **Lenguaje:** JavaScript plano + JSX (ver rationale de no-TS en Boundaries)
- **Framework:** React 18+, componentes funcionales, solo hooks
- **Styling:** Tailwind CSS. Sin CSS-in-JS. Tema colorido y lúdico, pero
  tipografía y espaciado elegantes (inspiración: Crafting Interpreters)
- **Widgets:** autocontenidos. Sin estado global compartido. Props in,
  callbacks out.
- **Animación:** Framer Motion para transiciones; D3 transitions solo donde
  un layout DOM-driven lo requiera
- **Naming:** kebab-case para archivos, PascalCase para componentes
- **Comentarios:** solo cuando el POR QUÉ no es obvio

## 5. Testing Strategy

El testing del MVP es liviano — el objetivo es validar herramientas
experimentalmente, no shippear a producción.

- **Verificación manual en browser** es el método primario
- **Tests unitarios** solo para lógica pura (clases de DS: `BST.insert`,
  `Heap.bubbleUp`, etc.) usando Vitest
- **No E2E tests** en MVP
- **Toolchain C++ → WASM:** verificar end-to-end con un "hello world" + un
  ejercicio real de DS pasando por el pipeline completo

Experimentos viven en `/experiments` y son descartables; widgets "production"
viven en `/src/widgets` y llevan unit tests de su lógica core.

## 6. Boundaries

**Always:**
- MVP 100% estático — deployable a GitHub Pages, sin backend
- Cada widget debe funcionar standalone (droppable en un MDX en blanco)
- Performance: página interactiva < 3s en laptop típica; WASM cargado
  on-demand, no en el first paint
- Desktop-first (se va a proyectar en pantallas de clase)

**Ask before:**
- Agregar cualquier dependencia > 200KB gzipped
- Cambiar framework o build tool
- Introducir TypeScript (ver nota)
- Introducir cualquier backend / servidor / DB
- Cambiar APIs públicos de un widget después de estar usado en contenido

**Never:**
- Telemetría o analytics que filtren datos del estudiante
- Servicios de pago para el MVP (Firebase, Auth0, etc.)
- Abandonar el principio "misma página = estudio + presentación" sin
  discusión explícita

**Nota sobre TypeScript:** decisión: NO en MVP. Razón: overhead ralentiza
prototipado de herramientas. Revisitar cuando (a) haya múltiples autores de
widgets, (b) APIs se estabilicen, o (c) terceros escriban contenido. Migración
incremental vía JSDoc o `.d.ts` cuando llegue el momento.

**Fuera del alcance del MVP (registrado para después):**
- Auth / cuentas
- Persistencia de progreso (localStorage solo si trivial)
- UI de autoría de contenido
- Multi-curso
- Navegación tipo grafo (lineal/jerárquica suficiente para un curso)
- i18n
- Auditoría de accesibilidad (target WCAG AA post-MVP)
- Responsive móvil
