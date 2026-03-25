import { Controller, Get, Query } from '@nestjs/common';
import { TokensService } from './tokens.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  getTokens(@Query('chainId') chainId: string) {
    return this.tokensService.getTokens(chainId);
  }
}
