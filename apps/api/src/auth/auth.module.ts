import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [RedisModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
