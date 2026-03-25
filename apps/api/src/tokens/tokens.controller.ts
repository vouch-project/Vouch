import { Controller, Get, Query } from '@nestjs/common';
import { TokensService } from './tokens.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokenListService: TokensService) {}

  @Get()
  getTokens(@Query('chainId') chainId: string) {
    return this.tokenListService.getTokenList(chainId);
  }
}
