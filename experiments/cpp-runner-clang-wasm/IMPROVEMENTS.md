# CodeRunner — Mejoras pendientes

Backlog de ideas para iterar sobre el widget `<CodeRunner>`. No están
priorizadas ni comprometidas — es una lista para no olvidar.

## UX del editor

- **Reset** al código original del sample (botón o icono para volver al
  estado del `samples` prop)
- **Copy to clipboard** del código actual
- **Download** como archivo (`main.cpp`, `main.py`, según el runtime)
- **Shareable URL** — código codificado en la URL para compartir un
  snippet específico (ej. para que un alumno mande una consulta)
- **Keyboard shortcut** para Run (ej. `Ctrl+Enter` / `Cmd+Enter`)
- **Sticky Run button** cuando el editor hace scroll en fullscreen
- **Auto-resize** del panel izquierdo/derecho con un divisor arrastrable
- **Font-size toggle** (A− / A+) en los panels de output

## Errores y feedback

- **Resaltar línea del error** en el editor — parsear diagnostics de
  Clang (formato `file:line:col: error: ...`) y pintar squiggle debajo
  de la línea correspondiente
- **Click en error → salta a la línea**
- **Hints progresivos** (pista 1 → pista 2 → solución) — ya
  contemplado en el SPEC como feature pedagógica
- **Stderr separado de stdout** en el panel (browsercc y pyodide los
  mergean actualmente)

## Performance

- **Memoización**: si `{code, stdin, language}` no cambió desde el
  último run, saltar compile + reusar el `WebAssembly.Module`
- **Shared compiler** entre runners de la misma página — hoy cada
  runner crea su worker, con 3 runners tenemos 3 workers con 3 copias
  de Pyodide / browsercc en memoria (100MB extra por cada uno)
- **Cola visible** cuando hay múltiples runs pendientes (ej. dos
  runners piden compilar casi al mismo tiempo en modo shared)
- **Cancelación** de jobs si el usuario re-ejecuta o cambia el código
  antes de que termine
- **Auto-save a localStorage** del código por `(runnerId, language)`,
  así recargar la página no pierde las ediciones del student

## Warm-up / first load

El primer load en GitHub Pages tarda ~15s sin feedback visual. Ideas:

- **Barra de progreso** durante el warm-up con mensaje explicativo
  ("descargando compilador C++", "inicializando Python")
- **Lazy-load** del runtime solo al primer click Run (no on mount) —
  si el student nunca compila, cero bytes descargados
- **Service Worker** para cachear los WASM entre visitas (segunda
  carga = instantánea)
- **Compresión Brotli** en lugar de gzip donde el CDN lo soporte

## Features pedagógicas

- **Soporte multi-archivo** (`Node.h` + `Node.cpp` + `main.cpp`,
  `module.py` + `main.py`)
- **Tests automáticos** que validen la solución del usuario
  (`stdin fijo → stdout esperado`, con UI de "tests pasados X/Y")
- **Comparación con la solución óptima** del profe (diff lado a lado,
  o métricas: cantidad de líneas, complejidad estimada, tiempo de
  ejecución)
- **Read-only mode** — renderizar un snippet sin editor editable, para
  cuando el profe quiere mostrar código sin invitar a modificar
- **Input interactivo** (`cin >> x` con prompt en vivo) — hoy stdin
  es un textarea estático

## Estética

- **Re-diseño lúdico/colorido** estilo Crafting Interpreters /
  Distill.pub — tipografías más expresivas, micro-animaciones,
  transiciones entre embed ↔ fullscreen
- **Tema light** además del dark actual (o respetar
  `prefers-color-scheme`)
- **Animación de expand** con `layoutId` de Framer Motion para que el
  embed "crezca" hacia fullscreen

## Arquitectura

- **Tests unitarios** de `useRuntime` con un worker mock
- **Storybook** o similar para desarrollar cada runtime aisladamente
- **Separar `<CppEditor>` puro** de `<CodeRunner>` (editor sin Run
  para snippets read-only)
- **Runtime plugin API** formalizada con TypeScript types — útil
  cuando se habilite TS post-MVP

## Orden tentativo

Si hay que elegir 3 para hacer antes de pasar a visualizadores de DS:

1. **Auto-save a localStorage** — UX crítica, perder código por
   recargar es rompedor
2. **Ctrl+Enter para Run** + **Reset** — features rápidas, alto
   valor por hora invertida
3. **Resaltar línea del error** — lo que más diferencia un editor
   serio de un playground de juguete

Lo demás puede esperar a que aparezca el dolor real en uso.
