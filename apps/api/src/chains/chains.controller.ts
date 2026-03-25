import { Controller, Get, Query } from '@nestjs/common';
import { ChainsService } from './chains.service';

@Controller('chains')
export class ChainsController {
  constructor(private readonly chainService: ChainsService) {}

  @Get()
  getChains(@Query('networkId') networkId: string) {
    return this.chainService.getChainByNetworkId(networkId);
  }
}
