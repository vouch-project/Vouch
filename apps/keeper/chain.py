from __future__ import annotations

import logging
from typing import Any

from web3 import Web3
from web3.contract.contract import ContractFunction

from config import Settings

logger = logging.getLogger("vouch.keeper.chain")

_MINIMAL_ABI: list[dict[str, Any]] = [
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "getHealthFactor",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "liquidate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "expireLoan",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


class VaultChain:
    def __init__(self, settings: Settings) -> None:
        self._w3 = Web3(Web3.HTTPProvider(settings.keeper_rpc_url))
        if not self._w3.is_connected():
            raise RuntimeError(f"Cannot connect to RPC at {settings.keeper_rpc_url}")
        self._account = self._w3.eth.account.from_key(settings.keeper_private_key)
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(settings.keeper_contract_address),
            abi=_MINIMAL_ABI,
        )

    def get_health_factor(self, loan_id: int) -> int:
        result: int = self._contract.functions.getHealthFactor(loan_id).call()
        return result

    def liquidate(self, loan_id: int) -> None:
        self._send_tx(self._contract.functions.liquidate(loan_id))

    def expire_loan(self, loan_id: int) -> None:
        self._send_tx(self._contract.functions.expireLoan(loan_id))

    def _send_tx(self, fn: ContractFunction) -> None:
        nonce = self._w3.eth.get_transaction_count(self._account.address)
        tx = fn.build_transaction(
            {
                "from": self._account.address,
                "nonce": nonce,
                "gas": 200_000,
            }
        )
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt["status"] != 1:
            raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")
        logger.info("tx %s mined in block %s", tx_hash.hex(), receipt["blockNumber"])
