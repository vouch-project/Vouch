import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BlockchainListenerModule } from './blockchain-listener/blockchain-listener.module';
import { ChainsModule } from './chains/chains.module';
import { LoansModule } from './loans/loans.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ScoringModule } from './scoring/scoring.module';
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
        const privateKey = configService.get<string>('SUPABASE_EC_PRIVATE_KEY');
        const publicKey = configService.get<string>('SUPABASE_EC_PUBLIC_KEY');
        if (privateKey && publicKey) {
          return {
            privateKey: privateKey.replace(/\\n/g, '\n'),
            publicKey: publicKey.replace(/\\n/g, '\n'),
            signOptions: { expiresIn: '1h', algorithm: 'ES256' },
          };
        }
        return {
          secret: configService.get('JWT_SECRET'),
          signOptions: { expiresIn: '1h' },
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
    SupabaseModule,
    TokensModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
