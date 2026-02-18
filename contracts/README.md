# FixDescriptorKit Smart Contracts

> **Solidity contracts for onchain storage and verification of FIX asset descriptors**

A suite of Ethereum smart contracts that enable embedding FIX descriptors directly in token contracts (ERC20, ERC721) with gas-efficient storage (SSTORE2) and cryptographic verification (Merkle proofs).

[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-blue.svg)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built_with-Foundry-red.svg)](https://getfoundry.sh/)
[![OpenZeppelin](https://img.shields.io/badge/Uses-OpenZeppelin-blue.svg)](https://openzeppelin.com/contracts/)

## 🎯 Purpose

These smart contracts implement the onchain component of the FIX Descriptor specification:

- **Embedded Architecture** - Descriptors stored directly in asset contracts (not registries)
- **SSTORE2 Storage** - Gas-efficient SBE storage in contract bytecode
- **Merkle Verification** - Prove any field without revealing full descriptor
- **Token Integration** - Works with ERC20, ERC721, and custom token standards
- **Standard Interface** - `IFixDescriptor` for interoperability

## 📁 Contract Structure

```
contracts/src/
├── IFixDescriptor.sol              # Standard interface
├── FixDescriptorLib.sol            # Core library for easy integration
├── FixMerkleVerifier.sol           # Merkle proof verification library
├── DataContractFactory.sol         # SSTORE2 deployment utility
├── AssetTokenERC20.sol             # Example ERC20 with embedded descriptor
├── AssetTokenERC721.sol            # Example ERC721 with embedded descriptor
├── AssetTokenFactory.sol           # Factory for deploying asset tokens
└── examples/
    ├── AssetTokenERC20Upgradeable.sol   # Upgradeable ERC20 example
    └── AssetTokenERC721Upgradeable.sol  # Upgradeable ERC721 example
```

## ⚡ Easy Integration

Adding FIX descriptor support to your token takes just **3 steps** using `FixDescriptorLib`:

```solidity
// 1. Import library
import "./FixDescriptorLib.sol";
import "./IFixDescriptor.sol";

contract MyToken is ERC20, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    // 2. Add storage slot
    FixDescriptorLib.Storage private _fixDescriptor;

    // 3. Forward interface calls
    function getFixDescriptor() external view returns (FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }
    
    function getFixRoot() external view returns (bytes32) {
        return _fixDescriptor.getRoot();
    }
    
    function verifyField(...) external view returns (bool) {
        return _fixDescriptor.verifyFieldProof(...);
    }
}
```

✅ Works with **any token standard** (ERC20, ERC721, ERC1155, custom)  
✅ Works with **any upgrade pattern** (UUPS, Transparent, Beacon, or none)  
✅ All complex logic (SSTORE2, Merkle proofs, SBE reading) handled by library  

**📖 [Complete Integration Guide](./docs/INTEGRATION_GUIDE.md)**

## 🔑 Core Contracts

### `FixDescriptorLib.sol`

**The easiest way to add FIX descriptor support** - a comprehensive library that handles all the complexity:

- Storage struct pattern for maximum flexibility
- SSTORE2 reading with assembly optimization
- Merkle proof verification
- Works with upgradeable and non-upgradeable contracts

### `IFixDescriptor.sol`

The standard interface that all asset contracts with FIX descriptors should implement.

```solidity
interface IFixDescriptor {
    struct FixDescriptor {
        bytes32 schemaHash;      // FIX schema/dictionary hash
        bytes32 fixRoot;        // Merkle root commitment
        address fixSBEPtr;      // SSTORE2 address of SBE data
        uint32 fixSBELen;       // SBE byte length
        string schemaURI;       // Optional SBE schema URI
    }

    function getFixDescriptor() external view returns (FixDescriptor memory);
    function getFixRoot() external view returns (bytes32);
    function verifyField(
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) external view returns (bool);
    
    event FixDescriptorSet(
        bytes32 indexed fixRoot,
        bytes32 indexed schemaHash,
        address fixSBEPtr,
        uint32 fixSBELen
    );
}
```

### `FixMerkleVerifier.sol`

Library for verifying Merkle proofs. Gas cost: ~30-40k gas (typical depth 4-6).

### `DataContractFactory.sol`

Factory for deploying SBE data using SSTORE2 pattern (3-4x cheaper than storage slots).

### `AssetTokenERC20.sol` & `AssetTokenERC721.sol`

Example token implementations with embedded FIX descriptors.

### `AssetTokenFactory.sol`

Factory for deploying new asset tokens with descriptors.

## 🚀 Getting Started

### Prerequisites

- [Foundry](https://getfoundry.sh/) installed
- OpenZeppelin contracts (via git submodules)

### Installation

```bash
cd contracts

# Initialize OpenZeppelin submodules
git submodule update --init --recursive

# Build contracts
forge build

# Run tests
forge test
```

## 📖 Usage Examples

### Basic ERC20 Token

```solidity
import "./FixDescriptorLib.sol";

contract MyBondToken is ERC20, Ownable, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    FixDescriptorLib.Storage private _fixDescriptor;

    constructor() ERC20("MyBond", "BOND") Ownable(msg.sender) {}

    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }

    function getFixDescriptor() external view returns (FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }
    
    // ... other IFixDescriptor functions
}
```

### Upgradeable ERC20 Token

```solidity
import "./FixDescriptorLib.sol";

contract MyUpgradeableBond is 
    ERC20Upgradeable, 
    OwnableUpgradeable, 
    UUPSUpgradeable,
    IFixDescriptor 
{
    using FixDescriptorLib for FixDescriptorLib.Storage;
    FixDescriptorLib.Storage private _fixDescriptor;
    
    function initialize() public initializer {
        __ERC20_init("MyBond", "BOND");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }
    
    // ... same forwarding functions
    
    uint256[49] private __gap; // Reserve storage for upgrades
}
```

### Factory Deployment

```solidity
// Deploy SBE data via SSTORE2
DataContractFactory dataFactory = new DataContractFactory();
address sbePtr = dataFactory.deploy(sbeBytes);

// Create descriptor
IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
    schemaHash: keccak256(fixDictionaryBytes),
    fixRoot: merkleRoot,
    fixSBEPtr: sbePtr,
    fixSBELen: uint32(sbeBytes.length),
    schemaURI: "ipfs://..."
});

// Deploy token
AssetTokenFactory factory = new AssetTokenFactory();
address token = factory.deployERC20(
    "US Treasury Bond 2030",
    "USTB30",
    1000000 ether,
    descriptor
);
```

## 🚀 Deployment

```bash
# Deploy to Sepolia Testnet
forge script script/DeployAssetToken.s.sol \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

## 📚 Documentation

- **Integration Guide**: [INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md) - Comprehensive guide for adding FIX descriptors to your contracts
- **Main Repository**: [FixDescriptorKit](../README.md)
- **Technical Spec**: [Web Specification](https://fixdescriptor.vercel.app/spec)
- **TypeScript Library**: [packages/fixdescriptorkit-typescript](../packages/fixdescriptorkit-typescript/README.md)
- **Web App**: [apps/web](../apps/web/README.md)

## 💡 Why Use FixDescriptorLib?

| Feature | Library Pattern | Abstract Contract | Manual Implementation |
|---------|----------------|-------------------|----------------------|
| **Code to write** | ~10 lines | ~50 lines | ~150 lines |
| **Upgradeable support** | ✅ Any pattern | ⚠️ Separate version | ❌ Complex |
| **Gas efficiency** | ✅ Optimal | ⚠️ Delegatecall overhead | ✅ Optimal |
| **Maintenance** | ✅ Single library | ⚠️ Multiple versions | ❌ Manual updates |
| **Flexibility** | ✅ Works everywhere | ⚠️ Inheritance limits | ✅ Full control |

**Recommendation**: Use `FixDescriptorLib` for the best developer experience and maximum flexibility.

## 🔧 Foundry Commands

```bash
forge build          # Build contracts
forge test           # Run tests
forge test --gas-report  # Gas report
forge fmt            # Format code
```

## 📄 License

ISC License
