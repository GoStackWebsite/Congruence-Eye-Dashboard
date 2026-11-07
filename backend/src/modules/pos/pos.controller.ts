import { Body, Controller, Get, HttpCode, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { AuthUser, EdgeContext, MANAGER_PLUS } from '../../common/roles';
import { PosTransactionsDto } from './dto/pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Public()
  @UseGuards(JwtOrApiKeyGuard)
  @Post('transactions')
  @HttpCode(200)
  ingest(@Req() req: { user?: AuthUser; edge?: EdgeContext }, @Body() dto: PosTransactionsDto) {
    return this.pos.ingest({ user: req.user, edge: req.edge }, dto.transactions);
  }

  @Post('import')
  @HttpCode(200)
  @Roles(...MANAGER_PLUS)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  import(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.pos.importCsv(u, file?.buffer);
  }

  @Get('transactions')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.pos.list(u, q);
  }
}
