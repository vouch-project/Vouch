import { Controller, Get, Query } from '@nestjs/common';
import { TokenListService } from './tokens.service';

@Controller('tokens')
export class TokenListController {
  constructor(private readonly tokenListService: TokenListService) {}

  @Get()
  getTokens(@Query('chainId') chainId: string) {
    return this.tokenListService.getTokenList(chainId);
  }
}
