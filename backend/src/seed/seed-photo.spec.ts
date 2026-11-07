import sharp from 'sharp';
import { seedPhotoJpeg } from './trax';

describe('seed checklist photo', () => {
  it('is a real 640×480 JPEG, not a one-pixel placeholder', async () => {
    const buf = await seedPhotoJpeg();
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(buf.length).toBeGreaterThan(5_000);
    const meta = await sharp(buf).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 640, 480]);
    const { channels } = await sharp(buf).stats();
    expect(channels[0].stdev).toBeGreaterThan(10); // has content, not a flat grey box
  });
});
