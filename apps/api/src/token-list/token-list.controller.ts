import { Controller, Get } from '@nestjs/common';
import { TokenListService } from './token-list.service';

@Controller('token-list')
export class TokenListController {
  constructor(private readonly tokenListService: TokenListService) {}

  @Get()
  getTokens() {
    return this.tokenListService.tokenList;
  }
}
