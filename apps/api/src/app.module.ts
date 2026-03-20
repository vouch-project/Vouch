import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BlockchainListenerModule } from './blockchain-listener/blockchain-listener.module';
import { LoanModule } from './loan/loan.module';
import { SupabaseModule } from './supabase/supabase.module';
import { TokenListModule } from './token-list/token-list.module';

@Module({
  imports: [
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
    LoanModule,
    SupabaseModule,
    TokenListModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
