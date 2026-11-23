import { rmSync } from 'node:fs';

export default function globalTeardown(): void {
  if (process.env.E2E_TMP) rmSync(process.env.E2E_TMP, { recursive: true, force: true });
}
