# Presentation — Mejoras pendientes

Backlog táctico para el widget `<Presentation>`. No comprometido,
solo capturado para no perder las ideas entre sesiones.

## Navegación y flujo

- **URL hash deep-link** — `#slide=3` carga la presentación en el
  slide 3. Permite compartir un link a una sección específica o
  recuperar posición al recargar.
- **Outline / navegador de slides** — botón que abre un overlay con
  lista/thumbnails de todas las slides; click para saltar. Importante
  cuando hay muchas slides y el profe necesita ir a una específica.
- **Browser Fullscreen API** — `F11`-style, pide al navegador entrar
  en fullscreen real (oculta barra de URL y pestañas). Tecla `f` para
  toggle.
- **Custom slide breaks** — hoy solo `<h2>` parte slides. Agregar un
  componente `<SlideBreak />` o prop para permitir al autor dividir
  sin título visible.
- **Subsecciones (`<h3>`)** — decidir si dividen slides o no. Opción:
  prop `depth` (1 = h1, 2 = h2…) para controlar a qué nivel cortar.

## Experiencia del presentador

- **Speaker notes** — cada slide puede tener notas ocultas
  (`<SpeakerNotes>...</SpeakerNotes>` dentro de la sección) que el
  profe ve en un monitor secundario, pero NO se proyectan.
- **Modo dual presentador** — ventana secundaria (`window.open`) con:
  slide actual + próxima + notas + timer + control remoto. Sincronía
  vía `BroadcastChannel` o `localStorage` events.
- **Timer / clock** — contador de tiempo transcurrido en esquina,
  togglable. Útil para respetar duración de clase.
- **Progresión automática** — play/pause con tempo ajustable (ej.
  auto-advance cada 30s). Mal para clases vivas, útil para demos
  auto-running.

## Anotaciones y highlights

- **Laser pointer** — hold Alt + move para mostrar un punto fucsia
  sobre la slide, útil para llamar atención en vivo.
- **Dibujar sobre la slide** — canvas overlay, hold Shift + drag para
  dibujar flechas/círculos sobre el contenido. Clear con `C`.
- **Zoom/pan** — Ctrl+scroll para zoom en un widget específico
  durante la presentación.

## Transiciones y estética

- **Transiciones animadas entre slides** — fade, slide horizontal o
  vertical, con Framer Motion. Togglable (algunos profes las odian).
- **Por-slide background** — autor puede especificar una imagen o
  color de fondo por slide. Útil para slides de transición entre
  capítulos grandes.
- **Tema light** — hoy solo dark. Agregar tema claro para
  proyectores donde la sala tiene mucha luz ambiental.
- **Disable animations** — respetar `prefers-reduced-motion` del
  sistema operativo.

## Layouts de slide especiales

- **Slide "código grande"** — slide dedicado a mostrar un código
  runner con tipografía enorme y el panel de output a la derecha.
- **Slide "comparación"** — dos widgets lado a lado (ej. LinkedList
  vs Array, BFS vs DFS del mismo grafo).
- **Slide "pregunta"** — estilo prompt/quiz con opciones visibles,
  pausa para respuesta, luego reveal.
- **Widget pinneado** — widget que queda visible en varias slides
  sucesivas (ej. un gráfico de referencia). Evita tener que duplicar.

## Integración con el resto

- **Export a PDF** — generar un PDF de las slides para hand-out
  impreso (compromiso: los widgets se vuelven screenshots estáticos).
- **Export a MP4** — grabar auto-playback como video.
- **Deep-link con estado** — la URL codifica también el estado del
  lenguaje global + el código actual de cada runner, para compartir
  "el momento exacto" de la clase.
- **Modo "student que llegó tarde"** — al entrar en presentación,
  permitir al viewer navegar libre pero preservar la slide del
  profe (indicador "el profe está en 5/7"). Requiere backend de
  sincronía, post-MVP.

## Accesibilidad (post-MVP pero relevante)

- **Screen reader announcements** — anunciar el número de slide al
  cambiar (`aria-live` region).
- **Focus management** — al cambiar de slide, mover foco al h2 de la
  nueva slide para lectores de pantalla.
- **Navegación por teclado sin mouse** — ya hay arrow keys, pero
  auditar flujo completo.

## Arquitectura (diferir hasta necesidad)

- **Hook `usePresentation()`** — acceso al estado `{mode, currentSlide,
  setCurrentSlide}` desde componentes descendientes. Útil si un widget
  quiere saber "estoy en modo presentación" para renderizar distinto
  (ej. esconder controles no-esenciales).
- **Separar `<Slide>` explícito** — en vez de auto-split por `<h2>`,
  permitir marcado manual `<Slide title="...">...</Slide>`. Más
  verboso pero más control.
- **Renderer pluggable** — el layout del slide (cómo se centra,
  padding, tipografía) como prop o theme. Hoy hardcoded.
