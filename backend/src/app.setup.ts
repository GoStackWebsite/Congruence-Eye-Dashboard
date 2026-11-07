import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import { uploadDir } from './config/database.config';

/** Shared app configuration for main.ts and e2e tests. */
export function configureApp(app: NestExpressApplication, opts: { swagger?: boolean } = {}) {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true, credentials: true, exposedHeaders: ['Content-Disposition'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useBodyParser('json', { limit: '20mb' });
  const dir = uploadDir();
  fs.mkdirSync(dir, { recursive: true });
  app.useStaticAssets(dir, { prefix: '/uploads' });
  if (opts.swagger !== false) {
    const config = new DocumentBuilder()
      .setTitle('Congruence Eye API')
      .setDescription('Retail CCTV video analytics & store operations (see docs/API_CONTRACT.md)')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'edge')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  return app;
}
