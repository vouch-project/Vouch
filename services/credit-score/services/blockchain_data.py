import os
from typing import Dict, Any
from web3 import Web3
import httpx
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class BlockchainDataService:
    def __init__(self):
        self.rpc_url = os.getenv("RPC_URL_MAINNET", "https://eth-mainnet.g.alchemy.com/v2/demo")
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        self.etherscan_api_key = os.getenv("ETHERSCAN_API_KEY", "")

    async def fetch_wallet_data(self, wallet_address: str) -> Dict[str, Any]:
        """
        Fetch comprehensive on-chain data for a wallet address
        
        Args:
            wallet_address: Ethereum wallet address
            
        Returns:
            Dictionary containing wallet metrics
        """
        try:
            # Validate address
            if not self.w3.is_address(wallet_address):
                raise ValueError(f"Invalid Ethereum address: {wallet_address}")

            address = self.w3.to_checksum_address(wallet_address)
            
            # Fetch basic data
            balance = self.w3.eth.get_balance(address)
            balance_eth = self.w3.from_wei(balance, 'ether')
            
            # Fetch transaction history from Etherscan
            tx_data = await self._fetch_transaction_history(address)
            
            # Calculate metrics
            return {
                "wallet_address": address,
                "current_balance_eth": float(balance_eth),
                "transaction_count": tx_data["tx_count"],
                "account_age_days": tx_data["account_age_days"],
                "avg_balance_eth": tx_data["avg_balance"],
                "max_balance_eth": tx_data["max_balance"],
                "total_volume_eth": tx_data["total_volume"],
                "defi_protocols_used": tx_data["defi_protocols"],
                "nft_count": tx_data["nft_count"],
                "successful_loans": tx_data["successful_loans"],
                "defaulted_loans": tx_data["defaulted_loans"],
                "gas_spent_eth": tx_data["gas_spent"],
            }
        except Exception as e:
            logger.error(f"Error fetching wallet data: {str(e)}")
            # Return default values on error
            return self._get_default_metrics(wallet_address)

    async def _fetch_transaction_history(self, address: str) -> Dict[str, Any]:
        """Fetch transaction history from Etherscan API"""
        if not self.etherscan_api_key:
            logger.warning("Etherscan API key not configured. Using mock data.")
            return self._get_mock_transaction_data()

        try:
            async with httpx.AsyncClient() as client:
                # Fetch normal transactions
                url = f"https://api.etherscan.io/api"
                params = {
                    "module": "account",
                    "action": "txlist",
                    "address": address,
                    "startblock": 0,
                    "endblock": 99999999,
                    "sort": "asc",
                    "apikey": self.etherscan_api_key
                }
                
                response = await client.get(url, params=params)
                data = response.json()
                
                if data["status"] == "1":
                    transactions = data["result"]
                    return self._analyze_transactions(transactions)
                else:
                    return self._get_mock_transaction_data()
        except Exception as e:
            logger.error(f"Error fetching from Etherscan: {str(e)}")
            return self._get_mock_transaction_data()

    def _analyze_transactions(self, transactions: list) -> Dict[str, Any]:
        """Analyze transaction data to extract metrics"""
        if not transactions:
            return self._get_mock_transaction_data()

        # Calculate account age
        first_tx_timestamp = int(transactions[0]["timeStamp"])
        account_age_days = (datetime.now().timestamp() - first_tx_timestamp) / 86400

        # Calculate transaction metrics
        tx_count = len(transactions)
        total_volume = sum(float(tx["value"]) for tx in transactions) / 1e18
        gas_spent = sum(int(tx["gasUsed"]) * int(tx["gasPrice"]) for tx in transactions) / 1e18

        return {
            "tx_count": tx_count,
            "account_age_days": account_age_days,
            "avg_balance": total_volume / tx_count if tx_count > 0 else 0,
            "max_balance": max((float(tx["value"]) / 1e18 for tx in transactions), default=0),
            "total_volume": total_volume,
            "defi_protocols": self._count_defi_interactions(transactions),
            "nft_count": 0,  # Would need separate NFT API call
            "successful_loans": 0,  # Would need to check loan contracts
            "defaulted_loans": 0,
            "gas_spent": gas_spent,
        }

    def _count_defi_interactions(self, transactions: list) -> int:
        """Count interactions with known DeFi protocols"""
        # List of known DeFi protocol addresses (simplified)
        defi_protocols = {
            "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",  # Uniswap V2 Router
            "0xe592427a0aece92de3edee1f18e0157c05861564",  # Uniswap V3 Router
            "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9",  # Aave V2
            "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",  # Aave V3
        }
        
        interacted_protocols = set()
        for tx in transactions:
            if tx["to"] and tx["to"].lower() in defi_protocols:
                interacted_protocols.add(tx["to"].lower())
        
        return len(interacted_protocols)

    def _get_mock_transaction_data(self) -> Dict[str, Any]:
        """Return mock transaction data for testing"""
        return {
            "tx_count": 50,
            "account_age_days": 365,
            "avg_balance": 1.5,
            "max_balance": 5.0,
            "total_volume": 10.0,
            "defi_protocols": 3,
            "nft_count": 2,
            "successful_loans": 0,
            "defaulted_loans": 0,
            "gas_spent": 0.5,
        }

    def _get_default_metrics(self, address: str) -> Dict[str, Any]:
        """Return default metrics when data fetch fails"""
        return {
            "wallet_address": address,
            "current_balance_eth": 0.0,
            "transaction_count": 0,
            "account_age_days": 0,
            "avg_balance_eth": 0.0,
            "max_balance_eth": 0.0,
            "total_volume_eth": 0.0,
            "defi_protocols_used": 0,
            "nft_count": 0,
            "successful_loans": 0,
            "defaulted_loans": 0,
            "gas_spent_eth": 0.0,
        }
