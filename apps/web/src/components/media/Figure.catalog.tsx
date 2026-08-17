import type { CatalogEntry } from '../../lib/catalogEntry';

import { Figure } from './Figure';

// What an author writes is a path relative to their document; what runs here is
// the `asset:` key `remarkContentImages` rewrites it into. Same split as the
// SideBySide entry, whose snippets show fences and whose render shows what the
// fences became.
const COST_CURVE = 'asset:courses/sample-course/costo-busqueda.svg';
const ALT =
  'Dos curvas de costo sobre los mismos ejes: la búsqueda lineal sube en línea recta con el tamaño del arreglo, mientras la binaria se aplana casi de inmediato.';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const figureCatalogEntry: CatalogEntry = {
  name: 'Figure',
  family: 'media',
  description:
    'One image with its alternative text and, optionally, its caption. The atom of the media family: it renders a picture and nothing else.',
  whenToUse:
    'Whenever a document shows a picture. Put it beside a block of text with <Split>, or in a grid with <Mosaic> — layout lives in those containers, so a figure never grows a prop about its neighbours. ' +
    'The `alt` is a runtime contract rather than a type, because MDX is not typechecked and the reader who needs the alt is the one who cannot see that it is missing: a figure without it renders an authoring error instead of an image. An empty alt is an error too, except inside a <Mosaic>, which carries the description for the whole group. ' +
    'An image that resolves nowhere renders visibly broken and warns, exactly as an unresolved wiki-link does (ADR-0002): writing the slide before drawing the picture is a legitimate order of work.',
  props: [
    {
      name: 'src',
      type: 'string',
      description:
        'The image, written relative to the document (`./curva.svg`). The MDX pipeline rewrites it into an `asset:` key and the build emits the file, which is what makes the url correct under the deployed base path.',
    },
    {
      name: 'alt',
      type: 'string',
      description:
        'What the picture says, in Spanish (the page is served `lang="es"`). Required. Empty only inside a <Mosaic>.',
    },
    {
      name: 'caption',
      type: 'MDX',
      description: 'Optional visible caption, rendered under the image as a <figcaption>.',
    },
  ],
  examples: [
    {
      title: 'A figure with a caption',
      code: `<Figure
  src="./costo-busqueda.svg"
  alt="Dos curvas de costo sobre los mismos ejes: la búsqueda lineal sube en línea recta con el tamaño del arreglo, mientras la binaria se aplana casi de inmediato."
  caption="El costo de buscar, comparado"
/>`,
      render: () => <Figure src={COST_CURVE} alt={ALT} caption="El costo de buscar, comparado" />,
    },
    {
      title: 'Given no alt',
      code: `<Figure src="./costo-busqueda.svg" />`,
      render: () => <Figure src={COST_CURVE} />,
    },
    {
      title: 'Given an image that is not there',
      code: `<Figure src="./todavia-no-existe.svg" alt="Un heap dibujado como árbol" />`,
      render: () => (
        <Figure src="asset:courses/sample-course/todavia-no-existe.svg" alt="Un heap" />
      ),
    },
  ],
};
