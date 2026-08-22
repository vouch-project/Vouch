import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { readFileSync } from 'fs';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { AuthModule } from './auth/auth.module';
import { BlockchainListenerModule } from './blockchain-listener/blockchain-listener.module';
import { ChainsModule } from './chains/chains.module';
import { LoansModule } from './loans/loans.module';
import { ScoringModule } from './scoring/scoring.module';
import { StatsModule } from './stats/stats.module';
import { SupabaseModule } from './supabase/supabase.module';
import { TokensModule } from './tokens/tokens.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const privateKeyPath = configService.get<string>(
          'SUPABASE_EC_PRIVATE_KEY_PATH',
        );
        const publicKeyPath = configService.get<string>(
          'SUPABASE_EC_PUBLIC_KEY_PATH',
        );
        if (privateKeyPath || publicKeyPath) {
          if (!privateKeyPath || !publicKeyPath) {
            throw new Error(
              'Both SUPABASE_EC_PRIVATE_KEY_PATH and SUPABASE_EC_PUBLIC_KEY_PATH must be set',
            );
          }
          const readKey = (path: string, name: string) => {
            try {
              return readFileSync(path, 'utf8');
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              throw new Error(
                `Failed to read ${name} from "${path}": ${message}`,
              );
            }
          };
          return {
            privateKey: readKey(privateKeyPath, 'SUPABASE_EC_PRIVATE_KEY_PATH'),
            publicKey: readKey(publicKeyPath, 'SUPABASE_EC_PUBLIC_KEY_PATH'),
            signOptions: { expiresIn: '1h', algorithm: 'ES256' },
            verifyOptions: { algorithms: ['ES256'] },
          };
        }
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_SECRET must be set when EC keys are not configured',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: '1h', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
      inject: [ConfigService],
    }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD,
      },
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    BlockchainListenerModule,
    ChainsModule,
    LoansModule,
    ScoringModule,
    StatsModule,
    SupabaseModule,
    TokensModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
