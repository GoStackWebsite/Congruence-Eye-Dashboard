import './env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  configureApp(app);
  serveFrontend(app);
  app.enableShutdownHooks();
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, process.env.HOST || '0.0.0.0');
  Logger.log(`Congruence Eye API on http://localhost:${port}/api (docs at /api/docs, DB_TYPE=${process.env.DB_TYPE || 'sqlite'})`, 'Bootstrap');
}
/** Serve the built Angular app from SERVE_FRONTEND_DIR (e.g. ./public) with the SPA index fallback, so one Node
 *  process answers /api, /uploads and the UI (SmarterASP.NET and the local launcher run it this way). */
function serveFrontend(app: NestExpressApplication) {
  const dir = process.env.SERVE_FRONTEND_DIR;
  if (!dir) return;
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) {
    Logger.warn(`SERVE_FRONTEND_DIR=${dir} has no index.html: UI not served`, 'Bootstrap');
    return;
  }
  app.useStaticAssets(root, { index: false, redirect: false, fallthrough: true, maxAge: '1h' });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const p = req.path;
    if (req.method !== 'GET' || p.startsWith('/api') || p.startsWith('/uploads') || p.includes('.')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  Logger.log(`Serving the UI from ${root}`, 'Bootstrap');
}

void bootstrap();
