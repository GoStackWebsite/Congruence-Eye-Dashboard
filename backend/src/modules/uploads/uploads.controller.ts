import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, sniff, VIDEO_TYPES } from '../../common/file-magic';
import { uploadDir } from '../../config/database.config';

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};

/**
 * Image (jpeg/png/webp) or video (mp4/webm/quicktime) upload for checklists, up to 50 MB (same limit as
 * /api/documents). The type is taken from the file's magic number — the declared Content-Type and the file
 * name are ignored, so a renamed executable is rejected. Served from /uploads/files/<random name>.
 */
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    const kind = sniff(file.buffer);
    if (!kind || ![...IMAGE_TYPES, ...VIDEO_TYPES].includes(kind)) throw new BadRequestException('Only jpeg/png/webp images or mp4/webm/quicktime videos are accepted');
    const ext = EXT[kind];
    const dir = path.join(uploadDir(), 'files');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, name), file.buffer);
    return { url: `/uploads/files/${name}` };
  }
}
