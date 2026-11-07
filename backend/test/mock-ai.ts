import * as http from 'http';

/** Tiny stand-in for the ai-service: images whose bytes contain "BADIMAGE" FAIL, others PASS. */
export interface MockAi {
  url: string;
  calls: { path: string; fields: string[] }[];
  close: () => Promise<void>;
}

const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

export async function startMockAi(): Promise<MockAi> {
  const calls: MockAi['calls'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const fields = [...body.matchAll(/; name="([^"]+)"/g)].map((m) => m[1]);
      calls.push({ path: req.url ?? '', fields });
      const imagePart = body.split(/name="image"/)[1]?.split(/\r\n--/)[0] ?? '';
      const bad = imagePart.includes('BADIMAGE');
      const uniform = (req.url ?? '').includes('uniform');
      const payload = bad
        ? { status: 'FAIL', score: 0.31, message: uniform ? 'Not groomed: name badge missing' : 'Signage does not match the approved reference', issues: [uniform ? 'name badge missing' : 'banner missing'], annotatedJpegBase64: TINY_JPEG_B64 }
        : { status: 'PASS', score: 0.92, message: uniform ? 'Groomed' : 'Matches the reference', issues: [] as string[] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}

/** A minimal JPEG; `marker` is embedded in a COM segment so the mock can classify it. */
export function jpeg(marker = 'GOOD'): Buffer {
  const base = Buffer.from(TINY_JPEG_B64, 'base64');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, marker.length + 2]), Buffer.from(marker)]);
  return Buffer.concat([base.subarray(0, 2), com, base.subarray(2)]);
}
