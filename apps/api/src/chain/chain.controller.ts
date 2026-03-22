import { Controller, Get, Query } from '@nestjs/common';
import { ChainService } from './chain.service';

@Controller('chains')
export class ChainController {
  constructor(private readonly chainService: ChainService) {}

  @Get()
  getChains(@Query('networkId') networkId: string) {
    return this.chainService.getChainByNetworkId(networkId);
  }
}
