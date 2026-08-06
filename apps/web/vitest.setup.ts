import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library only auto-registers cleanup when a global afterEach exists;
// with globals disabled it must be wired explicitly.
afterEach(cleanup);
