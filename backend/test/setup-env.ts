// Applied before any module is imported in unit and e2e tests.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.DB_SYNC = 'true';
process.env.DISABLE_CRON = 'true';
process.env.JWT_SECRET = 'test-secret';
// legacy specs ingest "today at HH:mm" regardless of the wall clock; the edge-case spec re-enables the 10 min skew rule
process.env.INGEST_MAX_FUTURE_SEC = process.env.INGEST_MAX_FUTURE_SEC || '172800';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('path').join(require('os').tmpdir(), 'ce-test-uploads-' + process.pid);
