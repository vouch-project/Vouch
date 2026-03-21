import { Controller, Get, Query } from '@nestjs/common';
import { TokenListService } from './token-list.service';

@Controller('token-list')
export class TokenListController {
  constructor(private readonly tokenListService: TokenListService) {}

  @Get()
  getTokens(@Query('chainId') chainId: string) {
    return this.tokenListService.getTokenList(Number(chainId));
  }
}
