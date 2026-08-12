import type { ComponentPropsWithoutRef } from 'react';

/**
 * A markdown table, in a box that scrolls instead of widening the page.
 *
 * A table has a minimum content width; the paragraph of literal pipes it
 * replaced simply wrapped. Measured on `/d/java-desde-cpp` at 390px the moment
 * GFM landed: horizontal page overflow went from 108px to 340px. Reference
 * tables are exactly the content a student reads on a phone, and a page that
 * slides sideways under the thumb is worse than a table that does.
 *
 * The wrapper is what scrolls, not the table, so the header row and the column
 * widths keep behaving like a table.
 */
export function MdxTable(props: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  );
}
