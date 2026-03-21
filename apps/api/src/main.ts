import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const globalPrefix = 'api';

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(globalPrefix);
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
};

void bootstrap();
