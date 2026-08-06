import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100">
      <h1 className="text-4xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-4 text-lg text-slate-400">
        The document you are looking for does not exist.
      </p>
      <Link to="/" className="mt-6 text-sky-400 underline">
        Go to the course
      </Link>
    </main>
  );
}
