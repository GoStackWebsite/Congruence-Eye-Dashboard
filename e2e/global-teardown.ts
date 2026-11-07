import { killRecorded } from './global-setup';

export default async function globalTeardown() {
  // E2E_KEEP=true leaves the servers running for a following E2E_REUSE=true run (developer loop only)
  if (process.env.E2E_KEEP === 'true') return;
  killRecorded();
}
