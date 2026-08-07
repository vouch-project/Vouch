import type { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const globalPrefix = 'api';

const LOG_LEVELS: Record<string, LogLevel[]> = {
  debug: ['debug', 'verbose', 'log', 'warn', 'error'],
  verbose: ['verbose', 'log', 'warn', 'error'],
  log: ['log', 'warn', 'error'],
  warn: ['warn', 'error'],
  error: ['error'],
};

const bootstrap = async () => {
  const level = (process.env.LOG_LEVEL ?? 'log').toLowerCase();
  const logLevels = LOG_LEVELS[level] ?? LOG_LEVELS['log'];
  const app = await NestFactory.create(AppModule, { logger: logLevels });

  app.setGlobalPrefix(globalPrefix);
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
};

void bootstrap();
