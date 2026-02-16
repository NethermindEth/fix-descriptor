# FixDescriptorKit Deployment Guide

## Deploy Smart Contracts

### Prerequisites

- [Foundry](https://getfoundry.sh/) installed
- Private key with funds on target network
- RPC URL for target network
- Git submodules initialized (OpenZeppelin contracts)

### Deploy Asset Contracts

1. **Set up environment:**

```bash
cd contracts
cp .env.example .env
# Edit .env and add your PRIVATE_KEY and RPC_URL
```

2. **Deploy the DataContractFactory and example asset tokens:**

```bash
# Deploy to Sepolia testnet
forge script script/DeployAssetToken.s.sol \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast \
  --verify

# Or deploy to another network
forge script script/DeployAssetToken.s.sol \
  --rpc-url $YOUR_RPC_URL \
  --broadcast \
  --verify
```

3. **Deploy your own custom asset contract:**

Create your own contract implementing `IFixDescriptor`:

```solidity
import "./IFixDescriptor.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MyAsset is ERC20, IFixDescriptor {
    FixDescriptor private _descriptor;
    
    // Implement IFixDescriptor interface
    // ... (see AssetTokenERC20.sol for example)
}
```

4. **Set the FIX descriptor:**

After deployment, call `setFixDescriptor()` with your descriptor data:
- Generate descriptor off-chain using the TypeScript library
- Deploy SBE data via DataContractFactory
- Call `setFixDescriptor()` on your asset contract

### Contract Addresses

After deployment, save your contract addresses:
- DataContractFactory: `0x...`
- AssetTokenFactory: `0x...`
- Your AssetToken: `0x...`

You'll need these for the web app configuration.

---

## Deploy Web App to Vercel

### Option 1: Deploy from Repository Root (Recommended)

1. **Connect your GitHub repository to Vercel**
2. **Configure Project Settings in Vercel Dashboard:**
   - **Framework Preset:** Next.js
   - **Root Directory:** `apps/web`
   - **Build Command:** `npm run vercel-build` (from root)
   - **Output Directory:** `apps/web/.next`
   - **Install Command:** `npm install` (from root)

### Option 2: Deploy from apps/web directory (Alternative)
```bash
cd /Users/swp/dev/swapnilraj/fixdescriptorkit-evm/apps/web
vercel --prod
```

**Note:** The first option is recommended for monorepo deployments as it handles dependencies correctly.

### 2. Set Environment Variables in Vercel Dashboard

After deployment, go to your Vercel project dashboard → Settings → Environment Variables and add:

**Required Environment Variables:**
- **Name:** `FIXPARSER_LICENSE_KEY`
- **Value:** `FIXParser_QjtkyzBGvFLS0tLS1CRUdJTiBQR1AgU0lHTkVEIE1FU1NBR0UtLS0tLQpIYXNoOiBTSEE1MTIKCjguMy4zfHN3cEBuZXRoZXJtaW5kLmlvfDE3ODgzOTM2MDAwMDB8ZnJlZQotLS0tLUJFR0lOIFBHUCBTSUdOQVRVUkUtLS0tLQoKd3JzRUFSWUtBRzBGZ21pNGZYZ0pFQ0p3M09mWVRzVEpSUlFBQUFBQUFCd0FJSE5oYkhSQWJtOTBZWFJwCmIyNXpMbTl3Wlc1d1ozQnFjeTV2Y21jaHZ2SS9ZQnR1QlB1R3ozKzY3Y3hWcitPeEZveE8xNzhLL1dtdApUSlAxeGhZaEJDVmdXQ2dKSU50bVgrZVpnaUp3M09mWVRzVEpBQUNHYWdEK0o3ZTN4ZzByc0d4TVYwZlEKMzlIM29EUjFlTitPb2xCR2VKM002djkxVGhBQS8yeEFlSUlhbi9VaS9qT2xyNVdRdGdGR1BpemYrbjdwCmpZMWllZEJVTkxnTgo9eGZNWgotLS0tLUVORCBQR1A=`
- **Environments:** Production, Preview, Development
- **Name:** `GITHUB_GIST_TOKEN`
- **Value:** GitHub personal access token with Gist scope (server-only)
- **Environments:** Production, Preview, Development

**Optional Contract Environment Variables:**
- **Name:** `NEXT_PUBLIC_DATA_FACTORY_ADDRESS`
- **Value:** Your deployed DataContractFactory address
- **Name:** `NEXT_PUBLIC_ASSET_CONTRACT_ADDRESS` 
- **Value:** Your deployed asset contract address (implementing IFixDescriptor)

**Note:** With the new embedded architecture, you deploy your own asset contracts (ERC20, ERC721, etc.) that implement the `IFixDescriptor` interface. There is no central registry.

### 3. Redeploy to Apply Environment Variables
```bash
vercel --prod
```

## Build Process

The deployment will:
1. Install dependencies from the monorepo root
2. Build the `fixdescriptorkit-typescript` library
3. Build the Next.js application
4. Deploy serverless functions for API routes
5. Ensure submodules were checked out (`git submodule update --init --recursive`)

## Features

✅ FIX message parsing and canonicalization
✅ SBE encoding with deterministic output  
✅ Merkle tree generation and proof verification
✅ Onchain deployment via SSTORE2
✅ Smart contract integration with Sepolia testnet
✅ Wallet connectivity and transaction signing

## Troubleshooting

If deployment fails:
1. Ensure you're deploying from the `apps/web` directory
2. Check that all dependencies are correctly installed
3. Verify environment variables are set in Vercel dashboard
4. Check build logs for specific error messages
5. Verify submodules are present:

```bash
git submodule status
git submodule update --init --recursive
```

---

## Quick Start

### Option 1: Automated Script (Recommended)

```bash
# 1. Configure environment
cd contracts
cp .env.example .env
# Edit .env and add PRIVATE_KEY and RPC_URL

# 2. Run deployment script from repo root
cd ..
./deploy-and-test.sh

# 3. Start web app
npm run dev
```

Visit http://localhost:3000 to use the app.

### Option 2: Manual Steps

1) Configure environments

```bash
# Contracts
cd contracts
echo "PRIVATE_KEY=0xYOUR_PRIVATE_KEY" > .env
echo "RPC_URL=https://ethereum-sepolia-rpc.publicnode.com" >> .env

# Web app
cd ../apps/web
touch .env.local
echo "FIXPARSER_LICENSE_KEY=..." >> .env.local
```

2) Deploy contracts

```bash
cd /Users/swp/dev/swapnilraj/fixdescriptorkit-evm/contracts
forge script script/DeployAssetToken.s.sol \
  --rpc-url https://ethereum-hoodi-rpc.publicnode.com \
  --broadcast \
  --slow \
  -vvv
```

3) Update web app config

```bash
cd ../apps/web
echo "NEXT_PUBLIC_DATA_FACTORY_ADDRESS=0x1234..." >> .env.local
echo "NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS=0x5678..." >> .env.local
```

4) Start the dev server

```bash
cd /Users/swp/dev/swapnilraj/fixdescriptorkit-evm
npm run dev
```

---

## AssetTokenFactory Deployment Guide (Concise)

### Prerequisites

- Foundry installed (`forge --version`)
- Private key with funds on target network
- RPC URL for target network
- (Optional) Block explorer API key for verification

### Environment Setup

```bash
cd contracts
cp .env.example .env
# Edit .env:
# PRIVATE_KEY=0x...
# RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
# ETHERSCAN_API_KEY=...
```

For the web app:

```bash
cd ../apps/web
touch .env.local
# Add:
# FIXPARSER_LICENSE_KEY=...
# NEXT_PUBLIC_DATA_FACTORY_ADDRESS=0x...
# NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS=0x...
```

### Deploy

Sepolia Testnet (recommended):

```bash
cd /Users/swp/dev/swapnilraj/fixdescriptorkit-evm/contracts
forge script script/DeployAssetToken.s.sol \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast \
  --slow \
  -vvv
```

Other networks:

```bash
forge script script/DeployAssetToken.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --slow \
  -vvv
```

Expected output includes addresses for `DataContractFactory` and `AssetTokenFactory`. Save them and update `.env.local` accordingly.

### Verify Deployments

```bash
# Check code exists
cast code 0xYOUR_DATA_FACTORY_ADDRESS --rpc-url $RPC_URL
cast code 0xYOUR_TOKEN_FACTORY_ADDRESS --rpc-url $RPC_URL
```

### Local App Test Checklist

- Connect MetaMask to your target network
- Paste a FIX message and Generate Preview
- Use Quick Deploy Token to test factory flow

---

## Supported Networks

- Sepolia Testnet (Chain ID: 11155111)
- Ethereum Mainnet (Chain ID: 1)
