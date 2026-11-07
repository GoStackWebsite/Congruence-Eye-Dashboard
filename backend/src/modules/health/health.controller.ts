import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}
  @Public()
  @Get()
  async health() {
    let db = 'up';
    try {
      await this.ds.query('SELECT 1');
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, time: new Date().toISOString() };
  }
}
