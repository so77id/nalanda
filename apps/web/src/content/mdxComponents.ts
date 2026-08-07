import { MdxLink } from './MdxLink';
import { headingFor } from './mdxHeading';

/** Content-owned MDX element mappings; the shell composes them with catalog components. */
export const contentMdxComponents = {
  a: MdxLink,
  h2: headingFor(2),
  h3: headingFor(3),
  h4: headingFor(4),
};
