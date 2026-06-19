import { Injectable } from '@nestjs/common';
import { asAddress } from '@vouch/database-types';
import { SupabaseService } from '../supabase/supabase.service';
import { CancelLoanDto } from './dto/cancel-loan.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { FundLoanDto } from './dto/fund-loan.dto';
import { PartialRepayLoanDto } from './dto/partial-repay-loan.dto';
import { RepayLoanDto } from './dto/repay-loan.dto';

@Injectable()
export class LoansService {
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
        p_on_chain_loan_id: createLoanDto.loanId.toString(),
        p_borrower_address: asAddress(createLoanDto.borrower),
        p_collateral_amount: createLoanDto.collateralAmount.toString(),
        p_requested_principal_token_address: asAddress(
          createLoanDto.requestedPrincipalTokenAddress,
        ),
        p_requested_principal_amount:
          createLoanDto.requestedPrincipalAmount.toString(),
        p_collateral_tx_hash: createLoanDto.collateralTxHash,
        p_collateral_block_number:
          createLoanDto.collateralBlockNumber.toString(),
        p_collateral_block_hash: createLoanDto.collateralBlockHash,
        p_log_index: createLoanDto.logIndex,
        p_collateral_locked_at: collateralLockedAt.toISOString(),
        p_interest_rate_bps: createLoanDto.interestRateBps,
        p_duration_seconds: createLoanDto.durationSeconds,
        p_fund_deadline: new Date(
          collateralLockedAt.getTime() + createLoanDto.fundWindowSeconds * 1000,
        ).toISOString(),
      },
    );

    if (error) throw error;
  }

  async fund({
    onChainLoanId,
    networkId,
    contractAddress,
    lenderAddress,
    borrowerAddress,
    principalAmount,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    fundedAt,
  }: FundLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'fund_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_borrower_address: asAddress(borrowerAddress),
        p_principal_amount: principalAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_funded_at: fundedAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async repay({
    onChainLoanId,
    networkId,
    contractAddress,
    borrowerAddress,
    lenderAddress,
    principalAmount,
    interestAmount,
    totalRepaid,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    repaidAt,
  }: RepayLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'repay_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_lender_address: asAddress(lenderAddress),
        p_principal_amount: principalAmount.toString(),
        p_interest_amount: interestAmount.toString(),
        p_total_repaid: totalRepaid.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_repaid_at: repaidAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async cancel({
    onChainLoanId,
    networkId,
    contractAddress,
    borrowerAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    cancelledAt,
  }: CancelLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'cancel_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_cancelled_at: cancelledAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async partialRepay({
    onChainLoanId,
    networkId,
    contractAddress,
    borrowerAddress,
    paymentAmount,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    paidAt,
  }: PartialRepayLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'record_partial_repayment',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_payment_amount: paymentAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_paid_at: paidAt.toISOString(),
      },
    );

    if (error) throw error;
  }
}
