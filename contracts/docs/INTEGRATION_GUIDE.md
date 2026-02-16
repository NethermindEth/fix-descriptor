# FIX Descriptor Integration Guide

> **A step-by-step guide to adding FIX descriptor support to your token contracts**

This guide shows you how to integrate FIX descriptor functionality into your token contracts using the `FixDescriptorLib` library. Whether you're building a simple ERC20, an NFT collection, or an upgradeable token, this guide has you covered.

## Table of Contents

- [Quick Start](#quick-start)
- [Basic Integration (Non-Upgradeable)](#basic-integration-non-upgradeable)
- [Upgradeable Integration](#upgradeable-integration)
- [Access Control Patterns](#access-control-patterns)
- [Per-Token vs Collection-Level Descriptors](#per-token-vs-collection-level-descriptors)
- [Gas Optimization Tips](#gas-optimization-tips)
- [Common Pitfalls](#common-pitfalls)
- [Complete Examples](#complete-examples)

---

## Quick Start

### 3-Step Integration

Adding FIX descriptor support to your token requires just **3 simple steps**:

```solidity
// STEP 1: Import and use the library
import "./FixDescriptorLib.sol";
import "./IFixDescriptor.sol";

contract MyToken is ERC20, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    // STEP 2: Add storage slot
    FixDescriptorLib.Storage private _fixDescriptor;

    // STEP 3: Forward IFixDescriptor function calls
    function getFixDescriptor() external view returns (FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }
    
    function getFixRoot() external view returns (bytes32) {
        return _fixDescriptor.getRoot();
    }
    
    // ... other interface functions
}
```

That's it! All the complex logic (SSTORE2 reading, Merkle verification) is handled by the library.

---

## Basic Integration (Non-Upgradeable)

### ERC20 Token Example

Here's a complete example of an ERC20 token with FIX descriptor support:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./IFixDescriptor.sol";
import "./FixDescriptorLib.sol";

contract MyBondToken is ERC20, Ownable, ERC165, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    FixDescriptorLib.Storage private _fixDescriptor;

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    // Setter with access control
    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }

    // IFixDescriptor implementation - just forward to library
    function getFixDescriptor() external view override returns (FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }

    function getFixRoot() external view override returns (bytes32) {
        return _fixDescriptor.getRoot();
    }

    function verifyField(
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) external view override returns (bool) {
        return _fixDescriptor.verifyFieldProof(pathCBOR, value, proof, directions);
    }

    // ERC165 support
    function supportsInterface(bytes4 interfaceId) 
        public view virtual override(ERC165) returns (bool) 
    {
        return interfaceId == FixDescriptorLib.getInterfaceId() || 
               super.supportsInterface(interfaceId);
    }
}
```

### ERC721 Token Example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IFixDescriptor.sol";
import "./FixDescriptorLib.sol";

contract MyNFT is ERC721, Ownable, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    FixDescriptorLib.Storage private _fixDescriptor;
    uint256 private _nextTokenId;

    constructor(string memory name, string memory symbol) 
        ERC721(name, symbol) 
        Ownable(msg.sender) 
    {}

    function mint(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }

    // ... same IFixDescriptor forwarding functions as ERC20 example
}
```

---

## Upgradeable Integration

When building upgradeable contracts, the library pattern shines because it works with **any upgrade pattern** (UUPS, Transparent Proxy, Beacon).

### Key Considerations for Upgradeable Contracts

1. **No constructor** - use `initializer` instead
2. **Storage gaps** - reserve slots for future upgrades
3. **Import upgradeable contracts** - use OpenZeppelin's upgradeable versions

### UUPS Example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IFixDescriptor.sol";
import "./FixDescriptorLib.sol";

contract MyUpgradeableBondToken is 
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IFixDescriptor 
{
    using FixDescriptorLib for FixDescriptorLib.Storage;

    FixDescriptorLib.Storage private _fixDescriptor;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) public initializer {
        __ERC20_init(name, symbol);
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        
        _mint(msg.sender, initialSupply);
    }

    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }

    // ... IFixDescriptor forwarding functions (same as above)

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function supportsInterface(bytes4 interfaceId) 
        public view virtual override returns (bool) 
    {
        return interfaceId == FixDescriptorLib.getInterfaceId() || 
               super.supportsInterface(interfaceId);
    }

    // Reserve storage slots for future upgrades
    uint256[49] private __gap;
}
```

### Storage Layout Best Practices

When using upgradeable contracts:

1. **Add storage gap** - Reserve ~50 slots after your state variables
2. **Never reorder storage** - Always add new variables at the end
3. **Test upgrades** - Use OpenZeppelin's upgrade plugin to validate

```solidity
contract MyUpgradeableToken {
    // Existing storage
    FixDescriptorLib.Storage private _fixDescriptor;
    uint256 private _someOtherState;
    
    // Reserve storage gap (50 - number of storage slots used)
    uint256[48] private __gap;
}
```

---

## Access Control Patterns

The library provides **internal functions** without access control, giving you complete flexibility.

### Pattern 1: Ownable (Recommended for Simple Cases)

```solidity
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    FixDescriptorLib.Storage private _fixDescriptor;

    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }
}
```

### Pattern 2: AccessControl (Role-Based)

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";

contract MyToken is ERC20, AccessControl, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    FixDescriptorLib.Storage private _fixDescriptor;

    bytes32 public constant DESCRIPTOR_MANAGER_ROLE = keccak256("DESCRIPTOR_MANAGER_ROLE");

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DESCRIPTOR_MANAGER_ROLE, msg.sender);
    }

    function setFixDescriptor(FixDescriptor calldata descriptor) 
        external 
        onlyRole(DESCRIPTOR_MANAGER_ROLE) 
    {
        _fixDescriptor.setDescriptor(descriptor);
    }
}
```

### Pattern 3: Custom Logic

```solidity
contract MyToken is ERC20, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    FixDescriptorLib.Storage private _fixDescriptor;

    address public immutable authorizedSetter;
    bool public descriptorLocked;

    constructor(address _authorizedSetter) {
        authorizedSetter = _authorizedSetter;
    }

    function setFixDescriptor(FixDescriptor calldata descriptor) external {
        require(msg.sender == authorizedSetter, "Unauthorized");
        require(!descriptorLocked, "Descriptor is locked");
        _fixDescriptor.setDescriptor(descriptor);
    }

    function lockDescriptor() external {
        require(msg.sender == authorizedSetter, "Unauthorized");
        descriptorLocked = true;
    }
}
```

---

## Per-Token vs Collection-Level Descriptors

### Collection-Level (Single Descriptor)

Most common for ERC20 or NFT collections with shared metadata:

```solidity
contract MyNFTCollection is ERC721, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    
    // Single descriptor for entire collection
    FixDescriptorLib.Storage private _collectionDescriptor;
    
    function getFixDescriptor() external view returns (FixDescriptor memory) {
        return _collectionDescriptor.getDescriptor();
    }
}
```

### Per-Token Descriptors

For NFTs where each token has unique FIX metadata:

```solidity
contract MyUniqueNFT is ERC721, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    
    // Mapping from token ID to descriptor
    mapping(uint256 => FixDescriptorLib.Storage) private _tokenDescriptors;
    
    function setTokenDescriptor(uint256 tokenId, FixDescriptor calldata descriptor) 
        external 
        onlyOwner 
    {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        _tokenDescriptors[tokenId].setDescriptor(descriptor);
    }
    
    function getTokenDescriptor(uint256 tokenId) 
        external 
        view 
        returns (FixDescriptor memory) 
    {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _tokenDescriptors[tokenId].getDescriptor();
    }
    
    // For IFixDescriptor compatibility, return descriptor for token 0
    function getFixDescriptor() external view returns (FixDescriptor memory) {
        return _tokenDescriptors[0].getDescriptor();
    }
}
```

---

## Gas Optimization Tips

### 1. Batch SBE Reads

Instead of multiple small reads:

```solidity
// ❌ Inefficient
bytes memory chunk1 = getFixSBEChunk(0, 100);
bytes memory chunk2 = getFixSBEChunk(100, 100);

// ✅ Efficient
bytes memory allData = getFixSBEChunk(0, 200);
```

### 2. Cache Descriptor Reads

```solidity
// ❌ Multiple storage reads
if (_fixDescriptor.getRoot() != bytes32(0)) {
    emit SomeEvent(_fixDescriptor.getRoot());
}

// ✅ Single storage read
bytes32 root = _fixDescriptor.getRoot();
if (root != bytes32(0)) {
    emit SomeEvent(root);
}
```

### 3. Use isInitialized() Check

```solidity
// Cheaper than trying to read and catching revert
if (_fixDescriptor.isInitialized()) {
    // Process descriptor
}
```

---

## Common Pitfalls

### ❌ Pitfall 1: Forgetting to Initialize in Constructor

```solidity
// BAD - descriptor never initialized
constructor() ERC20("MyToken", "MTK") {
    _mint(msg.sender, 1000000);
    // Forgot to set descriptor!
}
```

**Solution**: Initialize descriptor in constructor or provide setter function.

### ❌ Pitfall 2: Missing ERC165 Support

```solidity
// BAD - doesn't declare interface support
function supportsInterface(bytes4 interfaceId) public view returns (bool) {
    return super.supportsInterface(interfaceId);
    // Missing: interfaceId == FixDescriptorLib.getInterfaceId()
}
```

**Solution**: Always include FIX descriptor interface ID:

```solidity
function supportsInterface(bytes4 interfaceId) public view returns (bool) {
    return interfaceId == FixDescriptorLib.getInterfaceId() || 
           super.supportsInterface(interfaceId);
}
```

### ❌ Pitfall 3: Wrong Import for Upgradeable Contracts

```solidity
// BAD - using non-upgradeable contracts
import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; // ❌

// GOOD - using upgradeable contracts
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol"; // ✅
```

### ❌ Pitfall 4: Not Reserving Storage Gap

```solidity
// BAD - no storage gap in upgradeable contract
contract MyUpgradeableToken is ... {
    FixDescriptorLib.Storage private _fixDescriptor;
    // Missing __gap!
}

// GOOD
contract MyUpgradeableToken is ... {
    FixDescriptorLib.Storage private _fixDescriptor;
    uint256[49] private __gap; // ✅
}
```

---

## Complete Examples

Full working examples are available in the repository:

- **Basic ERC20**: [`AssetTokenERC20.sol`](../src/AssetTokenERC20.sol)
- **Basic ERC721**: [`AssetTokenERC721.sol`](../src/AssetTokenERC721.sol)
- **Upgradeable ERC20**: [`AssetTokenERC20Upgradeable.sol`](../src/examples/AssetTokenERC20Upgradeable.sol)
- **Upgradeable ERC721**: [`AssetTokenERC721Upgradeable.sol`](../src/examples/AssetTokenERC721Upgradeable.sol)
- **Factory Pattern**: [`AssetTokenFactory.sol`](../src/AssetTokenFactory.sol)

---

## Need Help?

- **Documentation**: [Main README](../../README.md)
- **Technical Spec**: [Web Specification](https://fixdescriptor.vercel.app/spec)
- **API Reference**: [IFixDescriptor.sol](../src/IFixDescriptor.sol)
- **Library Source**: [FixDescriptorLib.sol](../src/FixDescriptorLib.sol)

---

## Summary

Adding FIX descriptor support to your token is simple with `FixDescriptorLib`:

1. ✅ **Import** the library and interface
2. ✅ **Add** one storage variable
3. ✅ **Forward** interface calls to the library
4. ✅ **Done** - all complex logic is handled for you!

The library works with:
- ✅ Any token standard (ERC20, ERC721, ERC1155, custom)
- ✅ Any upgrade pattern (UUPS, Transparent, Beacon, or none)
- ✅ Any access control mechanism (Ownable, AccessControl, custom)
- ✅ Collection or per-token descriptors

Happy building! 🚀

