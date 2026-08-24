import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CreateSignedLendOfferDto } from './dto/create-signed-lend-offer.dto';
import { CreateSignedLoanRequestDto } from './dto/create-signed-loan-request.dto';
import { SignedOrdersService } from './signed-orders.service';

@Controller('loans')
export class SignedOrdersController {
  constructor(private readonly service: SignedOrdersService) {}

  @Post('signed-requests')
  createRequest(@Body() dto: CreateSignedLoanRequestDto) {
    return this.service.createLoanRequest(dto);
  }

  @Post('signed-offers')
  createOffer(@Body() dto: CreateSignedLendOfferDto) {
    return this.service.createLendOffer(dto);
  }

  @Get('signed-requests')
  listRequests() {
    return this.service.listLoanRequests();
  }

  @Get('signed-offers')
  listOffers() {
    return this.service.listLendOffers();
  }

  @Delete('signed-requests/:digest')
  @HttpCode(204)
  reportStaleRequest(@Param('digest') digest: string) {
    return this.service.reportStaleRequest(digest);
  }

  @Delete('signed-offers/:digest')
  @HttpCode(204)
  reportStaleOffer(@Param('digest') digest: string) {
    return this.service.reportStaleOffer(digest);
  }
}
