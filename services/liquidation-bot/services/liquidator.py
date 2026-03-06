import os
import logging
from typing import Dict, Any
from web3 import Web3
from eth_account import Account

logger = logging.getLogger(__name__)


class Liquidator:
    def __init__(self):
        # Initialize Web3
        rpc_url = os.getenv("RPC_URL_MAINNET", "https://eth-mainnet.g.alchemy.com/v2/demo")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        # Load private key
        private_key = os.getenv("PRIVATE_KEY", "")
        if private_key:
            self.account = Account.from_key(private_key)
            logger.info(f"Liquidator account: {self.account.address}")
        else:
            logger.warning("Private key not configured. Liquidation will be simulated.")
            self.account = None
        
        # Contract address
        self.lending_pool_address = os.getenv("LENDING_POOL_ADDRESS", "")
        
        # Load contract ABI
        self.lending_pool_abi = self._load_lending_pool_abi()
        
        if self.lending_pool_address:
            self.lending_pool = self.w3.eth.contract(
                address=Web3.to_checksum_address(self.lending_pool_address),
                abi=self.lending_pool_abi
            )
        else:
            logger.warning("Lending pool address not configured")
            self.lending_pool = None

    def liquidate_loan(self, loan_id: int, loan: Dict[str, Any]) -> str:
        """
        Execute liquidation for an underwater loan
        
        Args:
            loan_id: The ID of the loan to liquidate
            loan: Loan data dictionary
            
        Returns:
            Transaction hash
        """
        if not self.account or not self.lending_pool:
            logger.warning("Liquidation simulated (no account or contract configured)")
            return self._simulate_liquidation(loan_id, loan)

        try:
            logger.info(f"Preparing liquidation transaction for loan {loan_id}")
            
            # Build the transaction
            txn = self.lending_pool.functions.liquidate(
                loan_id,
                loan['debt_amount']  # Amount to repay
            ).build_transaction({
                'from': self.account.address,
                'nonce': self.w3.eth.get_transaction_count(self.account.address),
                'gas': 500000,
                'gasPrice': self.w3.eth.gas_price,
            })
            
            # Sign the transaction
            signed_txn = self.account.sign_transaction(txn)
            
            # Send the transaction
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            logger.info(f"Liquidation transaction sent: {tx_hash.hex()}")
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt['status'] == 1:
                logger.info(f"Liquidation confirmed! Block: {receipt['blockNumber']}")
                return tx_hash.hex()
            else:
                raise Exception("Transaction failed")
                
        except Exception as e:
            logger.error(f"Error executing liquidation: {str(e)}")
            raise

    def _simulate_liquidation(self, loan_id: int, loan: Dict[str, Any]) -> str:
        """Simulate a liquidation (for testing without real transactions)"""
        logger.info(f"SIMULATED: Would liquidate loan {loan_id}")
        logger.info(f"  Borrower: {loan['borrower']}")
        logger.info(f"  Collateral: {loan['collateral_amount']} {loan['collateral_token']}")
        logger.info(f"  Debt: {loan['debt_amount']} {loan['loan_token']}")
        
        # Return a fake transaction hash
        return f"0x{'0' * 64}"

    def _load_lending_pool_abi(self) -> list:
        """Load the lending pool contract ABI"""
        # Simplified ABI - in production, load from a JSON file
        return [
            {
                "inputs": [
                    {"name": "loanId", "type": "uint256"},
                    {"name": "repayAmount", "type": "uint256"}
                ],
                "name": "liquidate",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ]
