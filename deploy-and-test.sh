#!/bin/bash

# Interactive Factory Deployment and Testing Script
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  AssetTokenFactory Deployment & Testing Script        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env exists
if [ ! -f "contracts/.env" ]; then
    echo -e "${RED}❌ Error: contracts/.env not found${NC}"
    echo ""
    echo "Please create contracts/.env with:"
    echo "  PRIVATE_KEY=0x..."
    echo "  NEXT_PUBLIC_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com"
    echo ""
    exit 1
fi

# Load environment
source contracts/.env

if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}❌ Error: PRIVATE_KEY not set in contracts/.env${NC}"
    exit 1
fi

if [ -z "$NEXT_PUBLIC_RPC_URL" ]; then
    echo -e "${RED}❌ Error: NEXT_PUBLIC_RPC_URL not set in contracts/.env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment configured${NC}"
echo ""

# Step 1: Build contracts
echo -e "${BLUE}📦 Step 1: Building contracts...${NC}"
cd contracts
forge build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Contracts built successfully${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Deploy factory
echo -e "${BLUE}🚀 Step 2: Deploying factory to Sepolia...${NC}"
echo "   Network: $NEXT_PUBLIC_RPC_URL"
echo ""

forge script script/DeployAssetTokenWithFactory.s.sol \
  --rpc-url $NEXT_PUBLIC_RPC_URL \
  --broadcast \
  --slow \
  -vvv 2>&1 | tee ../deployment-output.log

DEPLOY_STATUS=${PIPESTATUS[0]}

if [ $DEPLOY_STATUS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Factory deployed successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

cd ..

# Extract addresses
echo ""
echo -e "${BLUE}📋 Step 3: Extracting deployment addresses...${NC}"

DATA_FACTORY=$(grep "DataContractFactory deployed at:" deployment-output.log | awk '{print $NF}')
TOKEN_FACTORY=$(grep "AssetTokenFactory deployed at:" deployment-output.log | awk '{print $NF}')
EXAMPLE_ERC20=$(grep "AssetTokenERC20 deployed at:" deployment-output.log | awk '{print $NF}')

if [ -z "$DATA_FACTORY" ] || [ -z "$TOKEN_FACTORY" ]; then
    echo -e "${YELLOW}⚠️  Could not automatically extract addresses${NC}"
    echo "Please check deployment-output.log manually"
    exit 0
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Deployment Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📍 Deployed Contract Addresses:${NC}"
echo ""
echo -e "  DataContractFactory:  ${GREEN}$DATA_FACTORY${NC}"
echo -e "  AssetTokenFactory:    ${GREEN}$TOKEN_FACTORY${NC}"
echo -e "  Example ERC20:        ${GREEN}$EXAMPLE_ERC20${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 4: Deploy a test token via factory
echo -e "${BLUE}🎯 Step 4: Deploying a test token via factory...${NC}"
echo ""

TOKEN_NAME="Test Asset Token"
TOKEN_SYMBOL="TAT"
INITIAL_SUPPLY="1000000000000000000000000" # 1M tokens with 18 decimals

echo "Token Details:"
echo "  Name: $TOKEN_NAME"
echo "  Symbol: $TOKEN_SYMBOL"
echo "  Supply: 1,000,000 tokens"
echo ""

cd contracts

# Deploy token via factory using cast
cast send $TOKEN_FACTORY \
  "deployAssetToken(string,string,uint256)" \
  "$TOKEN_NAME" "$TOKEN_SYMBOL" $INITIAL_SUPPLY \
  --rpc-url $NEXT_PUBLIC_RPC_URL \
  --private-key $PRIVATE_KEY \
  --json > ../deploy-token-output.json

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Token deployed successfully via factory!${NC}"
    
    # Extract transaction hash
    TX_HASH=$(cat ../deploy-token-output.json | grep -o '"transactionHash":"0x[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$TX_HASH" ]; then
        echo ""
        echo -e "${BLUE}Transaction Hash:${NC} ${GREEN}$TX_HASH${NC}"
        echo ""
        echo "View on Sepolia Etherscan:"
        echo "https://sepolia.etherscan.io/tx/$TX_HASH"
        echo ""
        
        # Wait for transaction and get token address from events
        echo "Waiting for transaction to be mined..."
        sleep 5
        
        # Get the token address from factory
        TOKEN_COUNT=$(cast call $TOKEN_FACTORY "getDeployedTokensCount()" --rpc-url $NEXT_PUBLIC_RPC_URL)
        echo ""
        echo -e "${BLUE}Total tokens deployed via factory:${NC} $TOKEN_COUNT"
    fi
else
    echo -e "${RED}❌ Token deployment failed${NC}"
fi

cd ..

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 All Done!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📝 Summary:${NC}"
echo ""
echo "1. Factory deployed at: ${GREEN}$TOKEN_FACTORY${NC}"
echo "2. Test token deployed via factory"
echo "3. Logs saved to: deployment-output.log"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "• View your contracts on Sepolia Etherscan"
echo "• Deploy more tokens using the factory address above"
echo "• Add FIX descriptors to your tokens"
echo ""
echo -e "${GREEN}Happy deploying! 🚀${NC}"

