import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In, IsNull } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseIntOpt, qstr } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { uploadDir } from '../../config/database.config';
import { DOCUMENT_TYPES, sniff } from '../../common/file-magic';
import { UploadDocumentDto } from './dto/document.dto';
import { DocumentFile } from './entities/document.entity';

export const documentsDir = () => path.join(uploadDir(), 'documents');

/**
 * Content type for a document from its bytes: executables and scripts/HTML are refused (MIME spoofing), a
 * declared image/video/PDF type must match the magic number, and plain text is always served as text/plain
 * (or text/csv) so nothing uploaded can be rendered as HTML.
 */
export function safeMime(buf: Buffer, declared?: string): string {
  const kind = sniff(buf);
  if (!kind || !DOCUMENT_TYPES.includes(kind)) throw new BadRequestException('File type not allowed (executables, scripts and HTML are refused)');
  const d = (declared || '').toLowerCase();
  if (kind === 'text') return d === 'text/csv' ? 'text/csv' : 'text/plain';
  if (kind === 'application/zip' || kind === 'application/x-ole') return /^application\/(vnd\.|msword|zip)/.test(d) ? d : 'application/octet-stream';
  return kind;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
  ) {}
  private get repo() {
    return this.ds.getRepository(DocumentFile);
  }

  async views(rows: DocumentFile[]) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.map((r) => r.uploadedById));
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      storeId: d.storeId ?? null,
      storeName: d.storeId ? (stores.get(d.storeId) ?? '') : null,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      uploadedByName: users.get(d.uploadedById) ?? '',
      createdAt: toIso(d.createdAt),
    }));
  }

  /** Documents with storeId null are company-wide and visible to everyone. */
  async list(user: AuthUser, q: Record<string, unknown>) {
    const sid = parseIntOpt(q.storeId);
    if (sid) this.scope.assert(user, sid);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    const where: object[] = [{ storeId: IsNull(), ...(q.category ? { category: qstr(q.category) } : {}) }];
    if (ids.length) where.push({ storeId: In(ids), ...(q.category ? { category: qstr(q.category) } : {}) });
    return this.views(await this.repo.find({ where, order: { id: 'DESC' } }));
  }

  async upload(user: AuthUser, dto: UploadDocumentDto, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    if (dto.storeId) await this.scope.assertStore(user, dto.storeId);
    return this.store(user.id, dto.title, dto.category, dto.storeId ?? null, file.originalname || 'document', safeMime(file.buffer, file.mimetype), file.buffer);
  }

  async store(userId: number, title: string, category: string, storeId: number | null, fileName: string, mimeType: string, buf: Buffer) {
    fs.mkdirSync(documentsDir(), { recursive: true });
    // the stored name never contains path parts from the client ("../../etc/passwd" → "passwd")
    const safe = path.basename(fileName.replace(/\\/g, '/')).replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '_').slice(-120);
    const storedName = `${Date.now()}-${randomBytes(4).toString('hex')}-${safe}`;
    fs.writeFileSync(path.join(documentsDir(), storedName), buf);
    const d = await this.repo.save(
      this.repo.create({ title, category, storeId, fileName: path.basename(fileName.replace(/\\/g, '/')).slice(-200) || 'document', storedName, mimeType: mimeType || 'application/octet-stream', size: buf.length, uploadedById: userId }),
    );
    return (await this.views([d]))[0];
  }

  async find(user: AuthUser, id: number) {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Document not found');
    if (d.storeId) this.scope.assert(user, d.storeId);
    return d;
  }

  async filePath(user: AuthUser, id: number) {
    const d = await this.find(user, id);
    const p = path.resolve(documentsDir(), d.storedName);
    // defence in depth: a tampered storedName must not escape the documents folder
    if (!p.startsWith(path.resolve(documentsDir()) + path.sep)) throw new NotFoundException('File missing on disk');
    if (!fs.existsSync(p)) throw new NotFoundException('File missing on disk');
    return { doc: d, path: p };
  }

  async remove(user: AuthUser, id: number) {
    const d = await this.find(user, id);
    await this.repo.delete(id);
    try {
      fs.unlinkSync(path.join(documentsDir(), d.storedName));
    } catch {
      /* already gone */
    }
    return { ok: true };
  }
}
