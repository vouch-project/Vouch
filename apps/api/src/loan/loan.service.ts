import { Injectable } from '@nestjs/common';
import { asAddress } from '../supabase/address';
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
    const { error } = await this.supabaseService.client.rpc(
      'create_loan_with_transaction',
      {
        p_network_id: networkId,
        p_collateral_token_address: asAddress(collateralTokenAddress),
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: createLoanDto.loanId,
        p_borrower_address: asAddress(createLoanDto.borrower),
        p_collateral_amount: Number(createLoanDto.collateralAmount),
        p_collateral_tx_hash: createLoanDto.collateralTxHash,
        p_collateral_block_number: Number(createLoanDto.collateralBlockNumber),
        p_collateral_block_hash: createLoanDto.collateralBlockHash,
        p_log_index: createLoanDto.logIndex,
        p_collateral_locked_at: collateralLockedAt.toISOString(),
      },
    );

    if (error) throw error;
  }
}
