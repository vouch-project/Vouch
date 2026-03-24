import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create({
    collateralTokenAddress,
    networkId,
    contractAddress,
    collateralLockedAt,
    ...createLoanDto
  }: CreateLoanDto) {
    const { data: chain, error: chainError } = await this.supabaseService.client
      .from('chains')
      .select('id')
      .eq('networkId', networkId)
      .single();

    if (chainError || !chain) throw new Error(`Chain not found: ${networkId}`);

    const collateralTokenAddressLower = collateralTokenAddress.toLowerCase();

    const { data: token, error: tokenError } = await this.supabaseService.client
      .from('tokens')
      .select('id')
      .eq('address', collateralTokenAddressLower)
      .eq('chainId', chain.id)
      .single();

    if (tokenError || !token)
      throw new Error(
        `Collateral token not found in tokens: ${collateralTokenAddress} on chain ${networkId}`,
      );

    const { data: loanInsertData, error: loanError } =
      await this.supabaseService.client
        .from('loans')
        .insert({
          onChainLoanId: createLoanDto.loanId,
          borrowerAddress: createLoanDto.borrower,
          collateralAmount: Number(createLoanDto.collateralAmount),
          collateralTokenId: token.id,
          chainId: chain.id,
          initialTxHash: createLoanDto.collateralTxHash,
        })
        .select('id')
        .single();

    if (loanError) throw loanError;

    // Insert transaction for collateral deposit
    await this.supabaseService.client.from('transactions').insert({
      loanId: loanInsertData.id,
      chainId: chain.id,
      tokenId: token.id,
      txHash: createLoanDto.collateralTxHash,
      blockNumber: Number(createLoanDto.collateralBlockNumber),
      blockHash: createLoanDto.collateralBlockHash,
      type: 'collateral_deposit',
      status: 'confirmed',
      fromAddress: createLoanDto.borrower,
      toAddress: contractAddress,
      amount: Number(createLoanDto.collateralAmount),
      logIndex: createLoanDto.logIndex,
      txTimestamp: collateralLockedAt,
    });
  }
}
