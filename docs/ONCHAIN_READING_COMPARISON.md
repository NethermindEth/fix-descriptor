# Reading FIX Parameters Onchain: Merkle Proof Verification

## Overview

When building smart contracts with embedded FIX descriptors, you need to read and verify field values onchain. This guide describes how to use Merkle proof verification for efficient field access.

**Approach:** Store SBE-encoded descriptors via SSTORE2 and use Merkle proof verification for field access. This provides logarithmic gas cost scaling (O(log n)) with descriptor size.

**Gas Performance:** Merkle proof verification costs **6k-12k gas** per field read, scaling logarithmically with the number of fields.

---

## Quick Reference

### Gas Costs Summary

| Field Type | Gas Cost | Notes |
|------------|----------|-------|
| Simple field (2-field descriptor) | ~6k gas | Logarithmic scaling (1 proof step) |
| Simple field (16-field descriptor) | ~8.5k gas | Logarithmic scaling (4 proof steps) |
| Nested group field | ~7.7k gas | Same as top-level |

### Storage Costs

- **SBE via SSTORE2:** ~100-200k gas (one-time, baseline)
- **Merkle root:** ~20k gas (one-time, 32 bytes)

**Total deployment:** ~120-220k gas

### Running Tests

```bash
cd contracts

# Run Merkle verification tests
forge test --match-contract FixDescriptorLibTest --gas-report

# Run example contract tests
forge test --match-contract AssetTokenTest --gas-report
```

---

## How Merkle Proof Verification Works

### Architecture

```
┌─────────────────────────────────────────┐
│ Contract Storage                        │
│  • SBE data in SSTORE2 (100-200k gas) │
│  • Merkle root (20k gas)                │
└─────────────────────────────────────────┘
              ↑                  ↓
    Generate proof          Verify proof
         (offchain)           (onchain)
              ↑                  ↓
┌─────────────┴──────────────────┴─────────┐
│ 1. Client builds Merkle tree offchain    │
│ 2. Client generates proof for field      │
│ 3. Client submits: value + proof         │
│ 4. Contract verifies: proof + root = ✓   │
└──────────────────────────────────────────┘
```

**Storage:** SBE data in SSTORE2 + Merkle root (32 bytes, 20k gas)

**Read Process:** 
1. Client generates Merkle proof offchain (from SBE descriptor or cached tree)
2. Client calls contract with field value + proof
3. Contract verifies proof against stored Merkle root (constant ~6-8.5k gas)

---

## Developer Experience

### Basic Field Verification

Reading fields requires proof parameters, but verification is cryptographically guaranteed:

```solidity
// Using FixDescriptorLib in your contract
contract MyToken is ERC20, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    
    FixDescriptorLib.Storage private _fixDescriptor;
    
    function verifySymbol(
        bytes calldata valueBytes,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) public view returns (bool) {
        // Build pathCBOR for tag 55: [55] -> 0x811837
        bytes memory pathCBOR = abi.encodePacked(uint8(0x81), uint8(0x18), uint8(55));
        
        return _fixDescriptor.verifyFieldProof(pathCBOR, valueBytes, proof, directions);
    }
}
```

**Client-side usage:**

```typescript
import { enumerateLeaves, generateProof } from 'fixdescriptorkit-typescript';

// One-time: Build Merkle tree from descriptor
const descriptor = {
  55: "AAPL",
  223: "4.250",
  541: "20250615"
};

const leaves = enumerateLeaves(descriptor);

// Generate proof for Symbol field
const symbolProof = generateProof(leaves, [55]);

// Call contract with proof
const isValid = await myToken.verifySymbol(
  symbolProof.valueBytes,
  symbolProof.proof,
  symbolProof.directions
);
```

### Nested Group Field Access

For fields inside repeating groups:

```solidity
function verifySecurityAltId(
    uint256 index,
    bytes calldata altIdValueBytes,
    bytes32[] calldata altIdProof,
    bool[] calldata altIdDirections,
    bytes calldata altIdSourceValueBytes,
    bytes32[] calldata altIdSourceProof,
    bool[] calldata altIdSourceDirections
) public view returns (bool) {
    // Build pathCBOR for SecurityAltID: [454, index, 455]
    bytes memory altIdPath = abi.encodePacked(
        uint8(0x83),        // Array of 3 elements
        uint8(0x19), uint16(454),  // Group tag
        uint8(index),       // Index
        uint8(0x19), uint16(455)   // Field tag
    );
    
    bool altIdValid = _fixDescriptor.verifyFieldProof(
        altIdPath, altIdValueBytes, altIdProof, altIdDirections
    );
    
    // Build pathCBOR for SecurityAltIDSource: [454, index, 456]
    bytes memory altIdSourcePath = abi.encodePacked(
        uint8(0x83),
        uint8(0x19), uint16(454),
        uint8(index),
        uint8(0x19), uint16(456)
    );
    
    bool altIdSourceValid = _fixDescriptor.verifyFieldProof(
        altIdSourcePath, altIdSourceValueBytes, altIdSourceProof, altIdSourceDirections
    );
    
    return altIdValid && altIdSourceValid;
}
```

---

## Gas Performance

### Logarithmic Verification Cost

Merkle proof verification has **logarithmic gas cost scaling** (O(log n)) with descriptor size:

| Descriptor Size | Verification Cost | Proof Length |
|-----------------|-------------------|--------------|
| 2 fields | ~6k gas | 1 hash |
| 5 fields | ~6-8k gas | 3 hashes |
| 16 fields | ~8.5k gas | 4 hashes |
| 50+ fields | ~12k gas | 6 hashes |

**Key Insight:** Gas cost scales logarithmically with descriptor size (log₂ of number of fields), making it highly efficient for large descriptors. The cost grows slowly - doubling the number of fields only adds ~500 gas per additional proof step.

### Storage Costs

| Component | Gas Cost | Notes |
|-----------|----------|-------|
| SBE via SSTORE2 | 100-200k | One-time, depends on descriptor size |
| Merkle root | 20k | One-time, 32 bytes (1 storage slot) |
| **Total** | **120-220k** | One-time deployment cost |

### Verification Costs

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Simple field verification | 6k-12k | Logarithmic scaling (O(log n)) |
| Nested group verification | 7.7k | Same as top-level |
| Proof calldata | 1.6k-3.2k | ~100-200 bytes at 16 gas/byte |
| **Total per access** | **~8-12k** | Includes verification + calldata |

---

## Example Contracts

### AssetTokenERC20

[View Source](../contracts/src/AssetTokenERC20.sol)

ERC20 token with FIX descriptor support:
- Uses `FixDescriptorLib` for descriptor management
- Implements `IFixDescriptor` interface
- Supports Merkle proof verification via `verifyField()`
- Can read SBE chunks via `getFixSBEChunk()`

### AssetTokenERC721

[View Source](../contracts/src/AssetTokenERC721.sol)

ERC721 NFT with FIX descriptor support:
- Collection-level descriptor storage
- Same verification interface as ERC20
- Ready for per-token extension

### AssetTokenFactory

[View Source](../contracts/src/AssetTokenFactory.sol)

Factory pattern for token deployment:
- Automated SBE storage deployment
- Descriptor initialization
- Simplified token creation workflow

---

## Client-Side Integration

### TypeScript SDK

```typescript
import { 
  enumerateLeaves, 
  generateProof,
  computeRoot 
} from 'fixdescriptorkit-typescript';

// 1. Parse FIX descriptor
const descriptor = {
  55: "AAPL",
  223: "4.250",
  541: "20250615"
};

// 2. Build Merkle tree
const leaves = enumerateLeaves(descriptor);
const root = computeRoot(leaves);

// 3. Generate proof for specific field
const symbolProof = generateProof(leaves, [55]);

// 4. Call contract with proof
const isValid = await contract.verifyField(
  symbolProof.pathCBOR,  // CBOR-encoded path
  symbolProof.valueBytes,
  symbolProof.proof,
  symbolProof.directions
);
```

### Proof Caching

For frequently accessed fields, cache proofs:

```typescript
// Generate proofs once
const proofCache = {
  symbol: generateProof(leaves, [55]),
  couponRate: generateProof(leaves, [223]),
  maturityDate: generateProof(leaves, [541])
};

// Reuse cached proofs for multiple calls
const symbolValid = await contract.verifyField(
  proofCache.symbol.pathCBOR,
  proofCache.symbol.valueBytes,
  proofCache.symbol.proof,
  proofCache.symbol.directions
);
```

---

## Path Encoding

Paths are arrays of integers that uniquely identify field locations:

### Simple Field Paths

```
Path: [55] → Symbol field
CBOR: 0x811837
```

### Group Field Paths

```
Path: [454, 0, 455] → SecurityAltID group, first entry, SecurityAltID field
CBOR: 0x831902c6001901c7
```

### Nested Group Paths

```
Path: [453, 0, 802, 1, 523] → Party group, first entry, PartySubID group, second entry, PartySubID field
```

See [MERKLE_VERIFIER.md](../contracts/docs/MERKLE_VERIFIER.md) for detailed path encoding documentation.

---

## Benefits

### Gas Efficiency

✅ **Logarithmic gas cost scaling** - 6k-12k gas, grows slowly with descriptor size (O(log n))  
✅ **Excellent scaling** - 16-field descriptor costs only ~40% more than 2-field  
✅ **Efficient nested groups** - Same cost as top-level fields  
✅ **Predictable costs** - Cost grows logarithmically, not linearly

### Security

✅ **Cryptographically secure** - Proof guarantees field authenticity  
✅ **Tamper-proof** - Cannot modify fields without changing root  
✅ **Selective disclosure** - Can verify specific fields without revealing others

### Flexibility

✅ **Works with any descriptor size** - From 2 fields to 50+ fields  
✅ **SBE storage** - Efficient storage via SSTORE2  
✅ **Standard interface** - `IFixDescriptor` interface for consistency

---

## Integration Guide

### Step 1: Add FixDescriptorLib to Your Contract

```solidity
import "./FixDescriptorLib.sol";
import "./IFixDescriptor.sol";

contract MyToken is ERC20, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;
    
    FixDescriptorLib.Storage private _fixDescriptor;
    
    // ... rest of contract
}
```

### Step 2: Set Descriptor

```solidity
function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
    _fixDescriptor.setDescriptor(descriptor);
}
```

### Step 3: Implement IFixDescriptor Interface

```solidity
function verifyField(
    bytes calldata pathCBOR,
    bytes calldata value,
    bytes32[] calldata proof,
    bool[] calldata directions
) external view override returns (bool) {
    return _fixDescriptor.verifyFieldProof(pathCBOR, value, proof, directions);
}

function getFixRoot() external view override returns (bytes32) {
    return _fixDescriptor.getRoot();
}

function getFixDescriptor() external view override returns (FixDescriptor memory) {
    return _fixDescriptor.getDescriptor();
}
```

See [INTEGRATION_GUIDE.md](../contracts/docs/INTEGRATION_GUIDE.md) for complete integration examples.

---

## Further Reading

### Documentation

- [Merkle Verifier Documentation](../contracts/docs/MERKLE_VERIFIER.md) - Merkle proof generation and verification
- [Integration Guide](../contracts/docs/INTEGRATION_GUIDE.md) - Step-by-step integration guide
- [Gas Analysis](../docs/GAS_ANALYSIS_HUMAN_READABLE.md) - Detailed gas analysis
- [Implementation Summary](../contracts/docs/IMPLEMENTATION_SUMMARY.md) - Complete implementation overview

### Tools & SDKs

- [TypeScript SDK](../packages/fixdescriptorkit-typescript) - Merkle proof generation and SBE encoding

---

## Summary

Merkle proof verification provides:

1. **Constant gas costs** - 6k-8.5k gas per verification regardless of descriptor size
2. **Efficient storage** - SBE via SSTORE2 + 32-byte Merkle root
3. **Cryptographic security** - Proof-based verification ensures field authenticity
4. **Scalability** - Handles descriptors of any size efficiently
5. **Standard interface** - `IFixDescriptor` for consistent integration

This approach is recommended for all production deployments requiring onchain FIX descriptor field verification.
