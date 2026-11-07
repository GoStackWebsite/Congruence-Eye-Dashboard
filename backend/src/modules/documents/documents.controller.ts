import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { MAX_UPLOAD_BYTES } from '../../common/file-magic';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.docs.list(u, q);
  }
  @Post()
  @Roles(...MANAGER_PLUS)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@CurrentUser() u: AuthUser, @Body() dto: UploadDocumentDto, @UploadedFile() file: Express.Multer.File) {
    return this.docs.upload(u, dto, file);
  }
  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Res() res: Response) {
    const { doc, path } = await this.docs.filePath(u, id);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // ASCII fallback + RFC 5987 UTF-8 name (Tamil / emoji file names); no quotes, CR/LF or path parts
    const ascii = doc.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.sendFile(path, { dotfiles: 'allow' }); // server-built path; UPLOAD_DIR may sit under a dot-directory
  }
  @Delete(':id') @Roles(...MANAGER_PLUS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.docs.remove(u, id);
  }
}
