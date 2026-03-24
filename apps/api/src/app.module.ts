import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BlockchainListenerModule } from './blockchain-listener/blockchain-listener.module';
import { ChainModule } from './chain/chain.module';
import { LoanModule } from './loan/loan.module';
import { SupabaseModule } from './supabase/supabase.module';
import { TokenListModule } from './tokens/tokens.module';

@Module({
  imports: [
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD,
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    BlockchainListenerModule,
    ChainModule,
    LoanModule,
    SupabaseModule,
    TokenListModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
