import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { asAddress } from '@vouch/database-types';
import { ethers } from 'ethers';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateSignedLendOfferDto } from './dto/create-signed-lend-offer.dto';
import { CreateSignedLoanRequestDto } from './dto/create-signed-loan-request.dto';
import { buildDomain, verifyLendOffer, verifyLoanRequest } from './eip712';

const BALANCE_OF_IFACE = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
]);

const readBalanceOf = async (
  provider: ethers.JsonRpcProvider,
  tokenAddr: string,
  owner: string,
): Promise<bigint> => {
  const raw = await provider.call({
    to: tokenAddr,
    data: BALANCE_OF_IFACE.encodeFunctionData('balanceOf', [owner]),
  });
  return BALANCE_OF_IFACE.decodeFunctionResult('balanceOf', raw)[0] as bigint;
};

const SIGNED_ORDER_TABLES = [
  'signed_loan_requests',
  'signed_lend_offers',
] as const;

@Injectable()
export class SignedOrdersService {
  private readonly logger = new Logger(SignedOrdersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleOrders(): Promise<void> {
    const now = new Date().toISOString();

    await Promise.all(
      SIGNED_ORDER_TABLES.map(async (table) => {
        const { data, error } = await this.supabaseService.client
          .from(table)
          .update({ status: 'expired' })
          .eq('status', 'open')
          .lt('deadline', now)
          .select('id');

        if (error) {
          this.logger.error(
            `Failed to expire stale ${table}: ${error.message}`,
          );
          return;
        }

        if (data && data.length > 0)
          this.logger.log(`Expired ${data.length} stale ${table} row(s)`);
      }),
    );
  }

  async createLoanRequest(
    dto: CreateSignedLoanRequestDto,
  ): Promise<{ digest: string }> {
    const collateralAmount = BigInt(dto.collateralAmount);
    const principalAmount = BigInt(dto.principalAmount);
    const nonce = BigInt(dto.nonce);
    const domain = buildDomain(BigInt(dto.networkId), dto.contractAddress);
    const value = {
      borrower: dto.borrowerAddress,
      collateralToken: dto.collateralTokenAddress,
      collateralAmount: collateralAmount.toString(),
      principalToken: dto.principalTokenAddress,
      principalAmount: principalAmount.toString(),
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      maxLtvBps: dto.maxLtvBps,
      nonce: nonce.toString(),
      deadline: dto.deadline.toString(),
    };
    const { valid, digest } = verifyLoanRequest(value, dto.signature, domain);
    if (!valid) throw new BadRequestException('Invalid signature');
    if (dto.deadline * 1000 <= Date.now())
      throw new BadRequestException('Request expired');
    if (
      dto.collateralTokenAddress ===
      '0x0000000000000000000000000000000000000000'
    )
      throw new BadRequestException('Collateral must be ERC20');
    if (collateralAmount <= 0n)
      throw new BadRequestException('Collateral amount must be > 0');
    if (principalAmount <= 0n)
      throw new BadRequestException('Principal amount must be > 0');
    if (dto.durationSeconds <= 0)
      throw new BadRequestException('Duration must be > 0');
    if (dto.interestRateBps > 10000)
      throw new BadRequestException('Interest rate cannot exceed 100%');
    if (dto.maxLtvBps <= 0 || dto.maxLtvBps > 10000)
      throw new BadRequestException('Invalid maxLtvBps');

    const { error } = await this.supabaseService.client.rpc(
      'insert_signed_loan_request',
      {
        p_network_id: dto.networkId,
        p_contract_address: asAddress(dto.contractAddress),
        p_digest: digest,
        p_borrower_address: asAddress(dto.borrowerAddress),
        p_collateral_token_address: asAddress(dto.collateralTokenAddress),
        p_collateral_amount: collateralAmount.toString(),
        p_principal_token_address: asAddress(dto.principalTokenAddress),
        p_principal_amount: principalAmount.toString(),
        p_interest_rate_bps: dto.interestRateBps,
        p_duration_seconds: dto.durationSeconds,
        p_max_ltv_bps: dto.maxLtvBps,
        p_nonce: nonce.toString(),
        p_deadline: new Date(dto.deadline * 1000).toISOString(),
        p_signature: dto.signature,
      },
    );
    if (error) throw error;
    return { digest };
  }

  async createLendOffer(
    dto: CreateSignedLendOfferDto,
  ): Promise<{ digest: string }> {
    const principalAmount = BigInt(dto.principalAmount);
    const nonce = BigInt(dto.nonce);
    const domain = buildDomain(BigInt(dto.networkId), dto.contractAddress);
    const value = {
      lender: dto.lenderAddress,
      principalToken: dto.principalTokenAddress,
      principalAmount: principalAmount.toString(),
      collateralRatioBps: dto.collateralRatioBps,
      trustedRatioBps: dto.trustedRatioBps,
      scoreThreshold: dto.scoreThreshold,
      maxLtvBps: dto.maxLtvBps,
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      nonce: nonce.toString(),
      deadline: dto.deadline.toString(),
    };
    const { valid, digest } = verifyLendOffer(value, dto.signature, domain);
    if (!valid) throw new BadRequestException('Invalid signature');
    if (dto.deadline * 1000 <= Date.now())
      throw new BadRequestException('Offer expired');
    if (
      dto.principalTokenAddress === '0x0000000000000000000000000000000000000000'
    )
      throw new BadRequestException('Principal must be ERC20');
    if (principalAmount <= 0n)
      throw new BadRequestException('Principal amount must be > 0');
    if (dto.durationSeconds <= 0)
      throw new BadRequestException('Duration must be > 0');
    if (dto.collateralRatioBps < 10000)
      throw new BadRequestException('Collateral ratio must be >= 100%');
    if (
      dto.trustedRatioBps !== 0 &&
      (dto.trustedRatioBps < 10000 ||
        dto.trustedRatioBps > dto.collateralRatioBps)
    )
      throw new BadRequestException('Invalid trustedRatioBps');
    if (dto.maxLtvBps <= 0 || dto.maxLtvBps > 10000)
      throw new BadRequestException('Invalid maxLtvBps');
    const minRatioBps =
      dto.trustedRatioBps > 0 ? dto.trustedRatioBps : dto.collateralRatioBps;
    if (dto.maxLtvBps * minRatioBps < 10000 * 10000)
      throw new BadRequestException('maxLtvBps below ratio-implied LTV');
    if (dto.interestRateBps > 10000)
      throw new BadRequestException('Interest rate cannot exceed 100%');

    const { error } = await this.supabaseService.client.rpc(
      'insert_signed_lend_offer',
      {
        p_network_id: dto.networkId,
        p_contract_address: asAddress(dto.contractAddress),
        p_digest: digest,
        p_lender_address: asAddress(dto.lenderAddress),
        p_principal_token_address: asAddress(dto.principalTokenAddress),
        p_principal_amount: principalAmount.toString(),
        p_collateral_token_address: null,
        p_collateral_ratio_bps: dto.collateralRatioBps,
        p_trusted_ratio_bps: dto.trustedRatioBps,
        p_score_threshold: dto.scoreThreshold,
        p_max_ltv_bps: dto.maxLtvBps,
        p_interest_rate_bps: dto.interestRateBps,
        p_duration_seconds: dto.durationSeconds,
        p_nonce: nonce.toString(),
        p_deadline: new Date(dto.deadline * 1000).toISOString(),
        p_signature: dto.signature,
      },
    );
    if (error) throw error;
    return { digest };
  }

  async listLoanRequests() {
    const { data, error } = await this.supabaseService.client
      .from('signed_loan_requests')
      .select('*')
      .eq('status', 'open')
      .gt('deadline', new Date().toISOString());
    if (error) throw error;
    return data;
  }

  async listLendOffers() {
    const { data, error } = await this.supabaseService.client
      .from('signed_lend_offers')
      .select('*')
      .eq('status', 'open')
      .gt('deadline', new Date().toISOString());
    if (error) throw error;
    return data;
  }

  async reportStaleRequest(digest: string): Promise<void> {
    const { data: order } = await this.supabaseService.client
      .from('signed_loan_requests')
      .select(
        `"borrowerAddress", "collateralAmount", collateralToken:tokens!collateralTokenId(address), chain:chains!chainId("rpcUrl", "wsRpcUrl")`,
      )
      .eq('digest', digest)
      .eq('status', 'open')
      .single();

    if (!order) return;

    const tokenAddr = order.collateralToken.address;
    const chainRow = order.chain;
    const rpcUrl = chainRow?.wsRpcUrl ?? chainRow?.rpcUrl;
    if (!tokenAddr || !rpcUrl) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balance = await readBalanceOf(
      provider,
      tokenAddr,
      order.borrowerAddress,
    );
    if (balance >= BigInt(order.collateralAmount)) return;

    await this.supabaseService.client
      .from('signed_loan_requests')
      .update({ status: 'cancelled' })
      .eq('digest', digest)
      .eq('status', 'open');

    this.logger.log(`Marked stale signed_loan_request cancelled: ${digest}`);
  }

  async reportStaleOffer(digest: string): Promise<void> {
    const { data: order } = await this.supabaseService.client
      .from('signed_lend_offers')
      .select(
        `"lenderAddress", "principalAmount", principalToken:tokens!principalTokenId(address), chain:chains!chainId("rpcUrl", "wsRpcUrl")`,
      )
      .eq('digest', digest)
      .eq('status', 'open')
      .single();

    if (!order) return;

    const tokenAddr = order.principalToken.address;
    const chainRow = order.chain;
    const rpcUrl = chainRow?.wsRpcUrl ?? chainRow?.rpcUrl;
    if (!tokenAddr || !rpcUrl) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balance = await readBalanceOf(
      provider,
      tokenAddr,
      order.lenderAddress,
    );
    if (balance >= BigInt(order.principalAmount)) return;

    await this.supabaseService.client
      .from('signed_lend_offers')
      .update({ status: 'cancelled' })
      .eq('digest', digest)
      .eq('status', 'open');

    this.logger.log(`Marked stale signed_lend_offer cancelled: ${digest}`);
  }
}
