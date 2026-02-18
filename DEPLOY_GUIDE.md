# Factory Deployment Guide

## Prerequisites

1. Create a `.env` file in the `contracts/` directory with:
```bash
PRIVATE_KEY=0x... # Your wallet private key
NEXT_PUBLIC_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

2. Ensure your wallet has Sepolia ETH for gas fees

## Step 1: Deploy the Factory

```bash
cd contracts
source .env  # Load environment variables
forge script script/DeployAssetTokenWithFactory.s.sol \
  --rpc-url $NEXT_PUBLIC_RPC_URL \
  --broadcast \
  --slow \
  --verify \
  -vvv
```

**Note:** The `--slow` flag is recommended to avoid rate limiting. The `--verify` flag is optional and requires an Etherscan API key.

This will deploy:
- DataContractFactory (for SSTORE2 storage)
- AssetTokenFactory (main factory)
- Example ERC20 token
- Example ERC721 token

## Step 2: Deploy an Asset via Factory

After deployment, you'll get the factory address. Use it to deploy tokens:

### Option A: Using Cast (CLI)

```bash
# Set variables
FACTORY_ADDRESS=0x... # From deployment output
TOKEN_NAME="My Asset Token"
TOKEN_SYMBOL="MAT"
INITIAL_SUPPLY=1000000000000000000000000 # 1M tokens (18 decimals)

# Deploy token
cast send $FACTORY_ADDRESS \
  "deployAssetToken(string,string,uint256)" \
  "$TOKEN_NAME" "$TOKEN_SYMBOL" $INITIAL_SUPPLY \
  --rpc-url $NEXT_PUBLIC_RPC_URL \
  --private-key $PRIVATE_KEY
```

### Option B: Using Forge Script

Create a new script or use the factory's `deployWithDescriptor` function for tokens with FIX descriptors.

## Deployed Contract Addresses

After deployment, save these addresses:
- DataContractFactory: `0x...`
- AssetTokenFactory: `0x...`

## Verify Contracts

If verification fails during deployment, verify manually:

```bash
# Set these variables first
DATA_FACTORY_ADDRESS=0x...  # From deployment output
FACTORY_ADDRESS=0x...       # AssetTokenFactory address
ETHERSCAN_API_KEY=...       # Your Etherscan API key

forge verify-contract \
  --chain sepolia \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --constructor-args $(cast abi-encode "constructor(address)" $DATA_FACTORY_ADDRESS) \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  $FACTORY_ADDRESS \
  src/AssetTokenFactory.sol:AssetTokenFactory
```

**Note:** You'll need an Etherscan API key. Get one at https://etherscan.io/apis

