import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Page } from '@playwright/test';
import { FFMPEG, TMP } from './env';

/** Facts about an mp4 read with ffmpeg (stderr of `ffmpeg -i`) plus the atom order (+faststart = moov before mdat). */
export function probeMp4(buf: Buffer): { codec: string; pixFmt: string; width: number; height: number; durationSec: number; faststart: boolean } {
  const file = path.join(TMP, `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(file, buf);
  try {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
    const info = r.stderr;
    const dur = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const vid = info.match(/Video: (\w+)[^,]*, (\w+)[^,]*(?:\([^)]*\))?, (\d+)x(\d+)/);
    if (!dur || !vid) throw new Error(`cannot parse ffmpeg output:\n${info}`);
    return {
      codec: vid[1],
      pixFmt: vid[2],
      width: Number(vid[3]),
      height: Number(vid[4]),
      durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
      faststart: buf.indexOf('moov') >= 0 && buf.indexOf('moov') < buf.indexOf('mdat'),
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Playwright's open-source Chromium build has no proprietary H.264 decoder (`canPlayType('video/mp4; codecs="avc1…"')`
 * is ""), while every real browser (Chrome, Edge, Safari, Android WebView) plays the recap mp4. So that the real
 * <video> element can still load the recap content, the harness transcodes each recap mp4 the page requests to VP8
 * WebM on the fly (same duration, smaller frame size and rate) and serves it at the same URL. The original mp4 is checked separately
 * with {@link probeMp4}.
 */
export async function serveMp4AsWebm(page: Page, urlGlob = '**/uploads/**/*.mp4') {
  const cache = new Map<string, Promise<Buffer>>(); // one transcode per URL even when the <video> issues several requests
  await page.route(urlGlob, async (route) => {
    const url = route.request().url();
    if (!cache.has(url)) {
      cache.set(url, (async () => {
        const headers = { ...route.request().headers() };
        delete headers.range; // fetch the whole file
        const original = await route.fetch({ headers, timeout: 60_000 });
        if (original.status() !== 200) throw new Error(`${url} → ${original.status()}`);
        const src = path.join(TMP, `tx-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
        const dst = src.replace(/\.mp4$/, '.webm');
        fs.writeFileSync(src, await original.body());
        try {
          // async (never block the test runner's event loop); small frame size keeps it fast, frames/duration are unchanged
          // 2 fps / 160 px keeps the transcode at ~3 s on an idle box (decoding the 1280 px H.264 dominates)
          const t0 = Date.now();
          await promisify(execFile)(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'fps=2,scale=160:-2', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '16', '-b:v', '100k', '-an', dst], { timeout: 170_000 });
          if (Date.now() - t0 > 20_000) console.warn(`[video] slow transcode of ${url}: ${Date.now() - t0} ms`);
          return fs.readFileSync(dst);
        } finally {
          fs.rmSync(src, { force: true });
          fs.rmSync(dst, { force: true });
        }
      })());
    }
    try {
      const body = await cache.get(url)!;
      await route.fulfill({ status: 200, contentType: 'video/webm', body, headers: { 'accept-ranges': 'none' } });
    } catch (e) {
      console.warn(`[video] cannot serve ${url} as webm: ${(e as Error).message}`);
      await route.abort().catch(() => undefined);
    }
  });
}
