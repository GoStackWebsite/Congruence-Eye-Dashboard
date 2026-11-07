// Loads .env (if present) before anything else reads process.env.
import * as fs from 'fs';
import * as path from 'path';

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile) && typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile(envFile);
  } catch {
    /* ignore malformed .env */
  }
}
