import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  // M-1: Security headers — X-Frame-Options, CSP, HSTS, X-Content-Type-Options
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));

  // H-3: Removed enableImplicitConversion — use explicit @Type() decorators in DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin.split(','),
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  // M-8: Graceful shutdown — lets Prisma disconnect and Redis quit cleanly
  app.enableShutdownHooks();

  const port = process.env.API_PORT || 4000;
  const host = process.env.API_HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`🚀 Nurse-App Backend running on http://${host}:${port}/api/v1`);
  console.log(`📊 Health check: http://${host}:${port}/api/v1/health`);
}

bootstrap();
