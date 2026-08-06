import { motion } from 'framer-motion';

export function Landing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h1 className="text-6xl font-bold tracking-tight">Nalanda</h1>
        <p className="mt-4 text-lg text-slate-400">
          Interactive learning platform — under construction.
        </p>
      </motion.div>
    </main>
  );
}
