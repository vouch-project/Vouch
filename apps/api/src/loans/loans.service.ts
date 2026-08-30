import { Injectable } from '@nestjs/common';
import { asAddress } from '@vouch/database-types';
import { SupabaseService } from '../supabase/supabase.service';
import { AcceptLendOfferDto } from './dto/accept-lend-offer.dto';
import { CancelLendOfferDto } from './dto/cancel-lend-offer.dto';
import { CancelLoanDto } from './dto/cancel-loan.dto';
import { CancelSignedOrderDto } from './dto/cancel-signed-order.dto';
import { CreateLendOfferDto } from './dto/create-lend-offer.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { ExpireLendOfferDto } from './dto/expire-lend-offer.dto';
import { ExpireLoanDto } from './dto/expire-loan.dto';
import { FillSignedOrderDto } from './dto/fill-signed-order.dto';
import { FundLoanDto } from './dto/fund-loan.dto';
import { LiquidateLoanDto } from './dto/liquidate-loan.dto';
import { PartialRepayLoanDto } from './dto/partial-repay-loan.dto';
import { RecordProtocolFeeDto } from './dto/record-protocol-fee.dto';
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
        p_log_index: createLoanDto.logIndex.toString(),
        p_collateral_locked_at: collateralLockedAt.toISOString(),
        p_interest_rate_bps: createLoanDto.interestRateBps,
        p_duration_seconds: createLoanDto.durationSeconds,
        p_fund_deadline:
          createLoanDto.fundWindowSeconds > 0
            ? new Date(
                collateralLockedAt.getTime() +
                  createLoanDto.fundWindowSeconds * 1000,
              ).toISOString()
            : undefined,
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
    principalRepaid,
    collateralReleased,
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
        p_principal_repaid: principalRepaid.toString(),
        p_collateral_released: collateralReleased.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_repaid_at: repaidAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async liquidate({
    onChainLoanId,
    networkId,
    contractAddress,
    liquidatorAddress,
    amountPaid,
    collateralSeized,
    principalRepaid,
    collateralReleased,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    liquidatedAt,
  }: LiquidateLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'liquidate_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_liquidator_address: asAddress(liquidatorAddress),
        p_amount_paid: amountPaid.toString(),
        p_collateral_seized: collateralSeized.toString(),
        p_principal_repaid: principalRepaid.toString(),
        p_collateral_released: collateralReleased.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_liquidated_at: liquidatedAt.toISOString(),
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

  async expire({
    onChainLoanId,
    networkId,
    contractAddress,
    borrowerAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    expiredAt,
  }: ExpireLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'expire_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_expired_at: expiredAt.toISOString(),
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
    principalRepaid,
    collateralReleased,
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
        p_principal_repaid: principalRepaid.toString(),
        p_collateral_released: collateralReleased.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_paid_at: paidAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async recordProtocolFee({
    onChainLoanId,
    networkId,
    contractAddress,
    treasuryAddress,
    feeAmount,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    collectedAt,
  }: RecordProtocolFeeDto) {
    const { error } = await this.supabaseService.client.rpc(
      'record_protocol_fee',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_treasury_address: asAddress(treasuryAddress),
        p_fee_amount: feeAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_collected_at: collectedAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async createLendOffer({
    lenderAddress,
    principalTokenAddress,
    principalAmount,
    collateralRatioBps,
    trustedRatioBps,
    scoreThreshold,
    maxLtvBps,
    interestRateBps,
    durationSeconds,
    acceptWindowSeconds,
    networkId,
    contractAddress,
    createdAt,
    ...dto
  }: CreateLendOfferDto) {
    const acceptDeadline = new Date(
      createdAt.getTime() + acceptWindowSeconds * 1000,
    );
    const { error } = await this.supabaseService.client.rpc(
      'create_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: dto.offerId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_principal_token_address: asAddress(principalTokenAddress),
        p_principal_amount: principalAmount.toString(),
        p_collateral_ratio_bps: collateralRatioBps,
        p_trusted_ratio_bps: trustedRatioBps,
        p_score_threshold: scoreThreshold,
        p_max_ltv_bps: maxLtvBps,
        p_interest_rate_bps: interestRateBps,
        p_duration_seconds: durationSeconds,
        p_accept_deadline: acceptDeadline.toISOString(),
        p_created_at: createdAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async acceptLendOffer({
    offerId,
    loanId,
    borrowerAddress,
    collateralTokenAddress,
    collateralAmount,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    collateralLogIndex,
    disbursementLogIndex,
    acceptedAt,
  }: AcceptLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'accept_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_on_chain_loan_id: loanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_collateral_token_address: asAddress(collateralTokenAddress),
        p_collateral_amount: collateralAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_collateral_log_index: collateralLogIndex.toString(),
        p_disbursement_log_index: disbursementLogIndex.toString(),
        p_accepted_at: acceptedAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async cancelLendOffer({
    offerId,
    lenderAddress,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    cancelledAt,
  }: CancelLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'cancel_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_cancelled_at: cancelledAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async expireLendOffer({
    offerId,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    expiredAt,
  }: ExpireLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'expire_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_expired_at: expiredAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async fillSignedOrder({
    orderKind,
    digest,
    loanId,
    fillerAddress,
    collateralTokenAddress,
    collateralAmount,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    collateralLogIndex,
    disbursementLogIndex,
    filledAt,
  }: FillSignedOrderDto) {
    const { error } = await this.supabaseService.client.rpc(
      'fill_signed_order_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_order_kind: orderKind,
        p_digest: digest,
        p_on_chain_loan_id: loanId.toString(),
        p_filler_address: asAddress(fillerAddress),
        p_collateral_token_address: asAddress(collateralTokenAddress),
        p_collateral_amount: collateralAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_collateral_log_index: collateralLogIndex.toString(),
        p_disbursement_log_index: disbursementLogIndex.toString(),
        p_filled_at: filledAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async cancelSignedOrder({
    digest,
    networkId,
    contractAddress,
  }: CancelSignedOrderDto) {
    const { error } = await this.supabaseService.client.rpc(
      'cancel_signed_order',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_digest: digest,
      },
    );
    if (error) throw error;
  }
}
