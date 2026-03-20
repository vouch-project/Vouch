import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('nonce')
  getNonce(@Query('address') address: string) {
    return { nonce: this.authService.getNonce(address) };
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return { token: this.authService.login(loginDto) };
  }
}
