import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('nonce')
  async getNonce(@Query('address') address: string) {
    return { nonce: await this.authService.getNonce(address) };
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return { token: await this.authService.login(loginDto) };
  }
}
