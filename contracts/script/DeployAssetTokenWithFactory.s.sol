// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DataContractFactory.sol";
import "../src/AssetTokenFactory.sol";
import "../src/AssetTokenERC20.sol";
import "../src/AssetTokenERC721.sol";

/**
 * @title DeployAssetToken
 * @notice Deployment script for asset tokens with embedded FIX descriptors
 * @dev Demonstrates deploying ERC20 and ERC721 tokens with FIX integration
 */
contract DeployAssetToken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy DataContractFactory for SBE storage
        DataContractFactory dataFactory = new DataContractFactory();
        console.log("DataContractFactory deployed at:", address(dataFactory));

        // Deploy AssetTokenFactory
        AssetTokenFactory tokenFactory = new AssetTokenFactory(address(dataFactory));
        console.log("AssetTokenFactory deployed at:", address(tokenFactory));

        // Deploy example ERC20 through factory
        address erc20Token = tokenFactory.deployAssetToken(
            "US Treasury Bond Token",
            "USTB",
            1000000 * 10**18  // 1M tokens
        );
        console.log("AssetTokenERC20 deployed at:", erc20Token);

        // Deploy ERC721 example (direct deployment)
        AssetTokenERC721 erc721Token = new AssetTokenERC721(
            "Asset Securities NFT",
            "ASNFT"
        );
        console.log("AssetTokenERC721 deployed at:", address(erc721Token));

        vm.stopBroadcast();

        // Log deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("Network:", block.chainid);
        console.log("DataContractFactory:", address(dataFactory));
        console.log("AssetTokenFactory:", address(tokenFactory));
        console.log("Example ERC20 Token:", erc20Token);
        console.log("Example ERC721 Token:", address(erc721Token));
        console.log("\n=== Environment Variables for Web App ===");
        console.log("NEXT_PUBLIC_DATA_FACTORY_ADDRESS=%s", address(dataFactory));
        console.log("NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS=%s", address(tokenFactory));
        console.log("\nNext steps:");
        console.log("1. Generate FIX descriptor off-chain");
        console.log("2. Use factory.deployWithDescriptor() for one-click deployment");
        console.log("3. Or use factory.deployAssetToken() + setFixDescriptor() separately");
    }
}
