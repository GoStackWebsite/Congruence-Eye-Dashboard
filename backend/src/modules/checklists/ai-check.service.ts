import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { uploadDir } from '../../config/database.config';
import { SettingsService } from '../settings/settings.service';
import { AiResult } from './entities/checklist-answer.entity';

export const AI_CHECKS = ['NONE', 'REFERENCE_MATCH', 'UNIFORM'];
const AI_TIMEOUT_MS = () => parseInt(process.env.AI_CHECK_TIMEOUT_MS || '20000', 10);

interface AiCheckResponse {
  status: 'PASS' | 'FAIL';
  score: number;
  message: string;
  issues?: string[];
  annotatedJpegBase64?: string;
}

/** Calls the ai-service AI-in-Checklist endpoints. Never throws: failures become status ERROR. */
@Injectable()
export class AiCheckService {
  private readonly log = new Logger(AiCheckService.name);
  constructor(private readonly settings: SettingsService) {}

  /** Reads an uploaded file by its `/uploads/...` url (or fetches an absolute http(s) url). */
  async load(url: string): Promise<Buffer> {
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(AI_TIMEOUT_MS()) });
      if (!r.ok) throw new Error(`cannot fetch ${url}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }
    const m = /^\/?uploads\/(.+)$/.exec(url.split('?')[0]);
    if (!m) throw new Error(`unsupported image url ${url}`);
    const base = path.resolve(uploadDir());
    const abs = path.resolve(base, decodeURIComponent(m[1]));
    if (!abs.startsWith(base + path.sep)) throw new Error('invalid image path');
    return fs.promises.readFile(abs);
  }

  async check(type: string, image: Buffer, reference?: Buffer | null, opts: { uniformHsv?: string } = {}): Promise<AiResult> {
    if (type === 'REFERENCE_MATCH' && !reference) return { status: 'SKIPPED', score: 0, message: 'No reference image configured', issues: [] };
    const base = (await this.settings.get()).aiServiceUrl.replace(/\/+$/, '');
    const endpoint = type === 'UNIFORM' ? '/ai/checklist/uniform' : '/ai/checklist/reference-match';
    try {
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'image.jpg');
      if (type === 'REFERENCE_MATCH' && reference) form.append('reference', new Blob([new Uint8Array(reference)], { type: 'image/jpeg' }), 'reference.jpg');
      if (type === 'UNIFORM' && opts.uniformHsv) form.append('uniformHsv', opts.uniformHsv);
      const r = await fetch(base + endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(AI_TIMEOUT_MS()) });
      if (!r.ok) throw new Error(`ai-service HTTP ${r.status}`);
      const body = (await r.json()) as AiCheckResponse;
      if (body.status !== 'PASS' && body.status !== 'FAIL') throw new Error('ai-service returned an invalid status');
      const result: AiResult = {
        status: body.status,
        score: Math.max(0, Math.min(1, Number(body.score) || 0)),
        message: String(body.message ?? ''),
        issues: Array.isArray(body.issues) ? body.issues.map(String) : [],
      };
      if (body.annotatedJpegBase64) result.annotatedUrl = this.saveAnnotated(body.annotatedJpegBase64);
      return result;
    } catch (e) {
      const msg = (e as Error).name === 'TimeoutError' ? 'AI service timed out' : `AI service unavailable: ${(e as Error).message}`;
      this.log.warn(msg);
      return { status: 'ERROR', score: 0, message: msg, issues: [] };
    }
  }

  /** Runs a check on uploaded urls (image + optional reference url). */
  async checkUrls(type: string, imageUrl: string, referenceUrl?: string | null): Promise<AiResult> {
    let image: Buffer;
    let reference: Buffer | null = null;
    try {
      image = await this.load(imageUrl);
      if (type === 'REFERENCE_MATCH' && referenceUrl) reference = await this.load(referenceUrl);
    } catch (e) {
      return { status: 'ERROR', score: 0, message: (e as Error).message, issues: [] };
    }
    return this.check(type, image, reference);
  }

  private saveAnnotated(b64: string): string {
    const dir = path.join(uploadDir(), 'ai');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
    return `/uploads/ai/${name}`;
  }
}
