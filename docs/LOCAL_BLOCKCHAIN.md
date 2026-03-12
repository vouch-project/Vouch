# Connecting MetaMask to the Development Blockchain

This guide explains how to connect your MetaMask wallet to the project's development network to access pre-funded testing accounts (10,000 ETH).

## 1. Prerequisites

Ensure the development blockchain server is active at `http://127.0.0.1:8545`.

_Note: If you are not running the node yourself, ensure you have the shared RPC URL from the project lead._

---

## 2. Configure the Local Network

MetaMask must be manually configured to "see" the development network.

1. Open **MetaMask**.
2. Click the **Network Selector** button in the middle-left.
3. Click **Add Network** -> **Add a network manually**.
4. Enter these exact values:
   - **Network Name:** `Hardhat Local`
   - **New RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency Symbol:** `ETH`
5. Click **Save** and ensure it is the active network.

---

## 3. Import a Pre-funded Account

By default, MetaMask accounts have 0 ETH.\
To test features, you must import one of the deterministic development keys:

1. Obtain a **Private Key** from the project's environment documentation.
   - _Example Dev Key:_ `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
2. In MetaMask, click the **Account Selector** (top left).
3. Click **Add wallet** -> **Import an account**.
4. Paste the Private Key and click **Import**.
5. The account should now reflect a balance of **10,000 ETH**.

---

## 4. Resolving "Nonce" or "Stuck" Transactions

If the local blockchain is restarted, MetaMask's internal history will become out of sync, causing transactions to fail or stay "Pending."

**To fix this:**

1. Click the **Burger Icon** (top right) -> **Settings**.
2. Go to **Advanced**.
3. Click **Clear activity tab data**.\
   _This resets the transaction counter so you can interact with the fresh state of the blockchain._

---

## 5. Using Reown AppKit

1. Open the application frontend.
2. Click **Connect Wallet**.
3. Select **Browser Wallet** (MetaMask).
4. Choose your imported 10,000 ETH account and click **Connect**.
