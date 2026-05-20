import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(private readonly httpService: HttpService) {}

  async getCreditScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<CreditScoreResponseDto>(
          `/api/v1/score/${encodeURIComponent(walletAddress.toLowerCase())}`,
        ),
      );
      return response.data;
    } catch (err) {
      this.logger.error(
        `ml-engine call failed for ${walletAddress}: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Credit scoring service unavailable',
      );
    }
  }
}
