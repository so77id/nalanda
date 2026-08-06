import SampleDoc from '@content/courses/sample-course/hello.mdx';

/** Temporary S1 proof route: renders one MDX document imported from content/. Superseded by /d/:id (S3). */
export function SamplePage() {
  return (
    <main>
      <SampleDoc />
    </main>
  );
}
