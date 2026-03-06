import os
import logging
from typing import List, Dict, Any
from web3 import Web3
from eth_abi import decode

logger = logging.getLogger(__name__)


class LoanMonitor:
    def __init__(self):
        # Initialize Web3
        rpc_url = os.getenv("RPC_URL_MAINNET", "https://eth-mainnet.g.alchemy.com/v2/demo")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        # Contract address
        self.lending_pool_address = os.getenv("LENDING_POOL_ADDRESS", "")
        
        # Load contract ABI (simplified)
        self.lending_pool_abi = self._load_lending_pool_abi()
        
        if self.lending_pool_address:
            self.lending_pool = self.w3.eth.contract(
                address=Web3.to_checksum_address(self.lending_pool_address),
                abi=self.lending_pool_abi
            )
        else:
            logger.warning("Lending pool address not configured")
            self.lending_pool = None

    def get_active_loans(self) -> List[Dict[str, Any]]:
        """
        Fetch all active loans from the smart contract
        
        Returns:
            List of active loan dictionaries
        """
        if not self.lending_pool:
            logger.warning("Lending pool contract not initialized. Using mock data.")
            return self._get_mock_loans()

        try:
            # Call the smart contract to get active loan IDs
            # This depends on your contract's actual implementation
            active_loan_ids = self.lending_pool.functions.getActiveLoanIds().call()
            
            loans = []
            for loan_id in active_loan_ids:
                loan_data = self.lending_pool.functions.getLoan(loan_id).call()
                loans.append(self._parse_loan_data(loan_id, loan_data))
            
            return loans
        except Exception as e:
            logger.error(f"Error fetching active loans: {str(e)}")
            return self._get_mock_loans()

    def calculate_health_factor(self, loan: Dict[str, Any]) -> float:
        """
        Calculate the health factor for a loan
        
        Health Factor = (Collateral Value * Liquidation Threshold) / Debt Value
        
        Args:
            loan: Loan dictionary
            
        Returns:
            Health factor (> 1.0 is healthy, < 1.0 is liquidatable)
        """
        try:
            # Get current collateral token price
            collateral_price = self._get_token_price(loan['collateral_token'])
            
            # Get current loan token price
            loan_token_price = self._get_token_price(loan['loan_token'])
            
            # Calculate collateral value in USD
            collateral_value = loan['collateral_amount'] * collateral_price
            
            # Calculate debt value in USD
            debt_value = loan['debt_amount'] * loan_token_price
            
            # Liquidation threshold (e.g., 80% = 0.8)
            liquidation_threshold = loan.get('liquidation_threshold', 0.8)
            
            # Calculate health factor
            if debt_value == 0:
                return float('inf')
            
            health_factor = (collateral_value * liquidation_threshold) / debt_value
            
            return health_factor
        except Exception as e:
            logger.error(f"Error calculating health factor: {str(e)}")
            return 1.5  # Default to healthy on error

    def _get_token_price(self, token_address: str) -> float:
        """
        Get current token price in USD
        
        In production, this would fetch from a price oracle or DEX
        """
        # Mock prices for demonstration
        mock_prices = {
            "ETH": 2500.0,
            "USDC": 1.0,
            "USDT": 1.0,
            "DAI": 1.0,
            "WBTC": 45000.0,
        }
        
        # Default to ETH price if unknown
        return mock_prices.get(token_address, 2500.0)

    def _parse_loan_data(self, loan_id: int, loan_data: tuple) -> Dict[str, Any]:
        """Parse loan data from smart contract response"""
        return {
            'loan_id': loan_id,
            'borrower': loan_data[0],
            'lender': loan_data[1],
            'collateral_amount': loan_data[2],
            'debt_amount': loan_data[3],
            'collateral_token': loan_data[4],
            'loan_token': loan_data[5],
            'liquidation_threshold': 0.8,
            'start_time': loan_data[6],
            'status': loan_data[7],
        }

    def _get_mock_loans(self) -> List[Dict[str, Any]]:
        """Return mock loan data for testing"""
        return [
            {
                'loan_id': 1,
                'borrower': '0x1234567890123456789012345678901234567890',
                'lender': '0x0987654321098765432109876543210987654321',
                'collateral_amount': 1.0,  # 1 ETH
                'debt_amount': 1500.0,  # 1500 USDC
                'collateral_token': 'ETH',
                'loan_token': 'USDC',
                'liquidation_threshold': 0.8,
                'start_time': 1234567890,
                'status': 'active',
            }
        ]

    def _load_lending_pool_abi(self) -> list:
        """Load the lending pool contract ABI"""
        # Simplified ABI - in production, load from a JSON file
        return [
            {
                "inputs": [],
                "name": "getActiveLoanIds",
                "outputs": [{"type": "uint256[]"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "loanId", "type": "uint256"}],
                "name": "getLoan",
                "outputs": [{"type": "tuple"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]
