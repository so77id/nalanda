import { MdxImage } from './MdxImage';
import { MdxLink } from './MdxLink';
import { MdxTable } from './MdxTable';
import { headingFor } from './mdxHeading';

/** Content-owned MDX element mappings; the shell composes them with catalog components. */
export const contentMdxComponents = {
  a: MdxLink,
  img: MdxImage,
  table: MdxTable,
  h2: headingFor(2),
  h3: headingFor(3),
  h4: headingFor(4),
};
