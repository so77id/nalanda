import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ground text-ink">
      <h1 className="text-4xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-4 text-lg text-ink-faint">
        The document you are looking for does not exist.
      </p>
      <Link to="/" className="mt-6 text-accent underline">
        Go to the course
      </Link>
    </main>
  );
}
