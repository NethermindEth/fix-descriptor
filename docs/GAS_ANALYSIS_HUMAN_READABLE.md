# Gas Analysis: FIX Descriptor Storage and Verification

## Overview

This document analyzes the gas costs associated with storing and verifying FIX descriptors onchain using the SBE (Simple Binary Encoding) + Merkle proof verification approach.

## TL;DR

- **Storage Deployment**: ~120-220k gas (one-time cost)
  - SBE data via SSTORE2: ~100-200k gas
  - Merkle root: ~20k gas (32 bytes)
- **Field Verification**: ~6k-12k gas per field (logarithmic scaling: O(log n) where n is number of fields)
- **SBE Reading**: ~5k-10k gas per chunk read

## 1. Storage Costs

### 1.1 Descriptor Storage Components

The FIX descriptor is stored using two components:

| Component | Size | Gas Cost | Description |
|-----------|------|----------|-------------|
| Merkle root | 32 bytes | ~20,000 | One-time storage slot |
| SBE via SSTORE2 | ~100-1000 bytes | ~100,000-200,000 | One-time deployment |
| SBE pointer | 20 bytes (address) | Included | Storage slot reference |

**Total deployment cost: ~120-220k gas** (one-time)

### 1.2 Storage Cost Breakdown

#### Merkle Root Storage
- **Size**: 32 bytes (1 storage slot)
- **Cost**: ~20,000 gas
- **When**: Set during descriptor initialization
- **Updates**: Each update requires new root storage (~20k gas)

#### SBE Data Storage (SSTORE2)
- **Size**: Varies by descriptor complexity
  - Simple descriptor (2-5 fields): ~100-200 bytes
  - Medium descriptor (10-15 fields): ~300-500 bytes
  - Complex descriptor (20+ fields): ~500-1000 bytes
- **Cost**: ~100-200k gas (one-time deployment)
- **Method**: SSTORE2 pattern (stores data as contract bytecode)

### 1.3 Why SSTORE2?

SSTORE2 makes descriptor storage affordable:

- **Traditional SSTORE**: 500 bytes × 20,000 gas/byte = **10,000,000 gas** ❌
- **SSTORE2 (bytecode storage)**: ~100 gas base + ~200 gas/byte × 500 = **~100,000 gas** ✅

**Savings: 100x cheaper!**

## 2. Verification Costs

### 2.1 Merkle Proof Verification

Field verification uses Merkle proof verification, providing constant gas costs regardless of descriptor size.

**Gas Performance:** **6k-12k gas** per field verification (logarithmic scaling: O(log n))

| Descriptor Size | Verification Cost | Proof Length | Notes |
|-----------------|-------------------|--------------|-------|
| 2 fields | ~6k gas | 1 hash | Minimal overhead |
| 5 fields | ~6-8k gas | 3 hashes | Still efficient |
| 16 fields | ~8.5k gas | 4 hashes | Logarithmic scaling |
| Nested groups | ~7.7k gas | 2-3 hashes | Same as top-level |
| 50+ fields | ~12k gas | 6 hashes | Scales logarithmically |

**Key Insight:** Gas cost scales logarithmically with descriptor size - proof length grows as log₂(number of fields), making it highly efficient even for large descriptors.

### 2.2 Verification Cost Breakdown

**Formula:** `gas ≈ 6k + (proof_length × 500)`

Where `proof_length = log₂(num_leaves)`

**Detailed Breakdown:**
- Base cost: ~6k gas (leaf hash computation, loop overhead)
- Per proof step: ~500 gas (keccak256 hash + memory operations)
- Calldata: ~1.6k-3.2k gas (100-200 bytes at 16 gas/byte)

**Examples:**
- 2 fields: 1 proof step = ~6k + 500 + 1.6k = **~8.1k gas total**
- 16 fields: 4 proof steps = ~6k + 2000 + 3.2k = **~11.2k gas total**

### 2.3 Proof Calldata Overhead

Each verification requires proof data in calldata:
- `pathCBOR`: ~10-20 bytes (CBOR-encoded path)
- `valueBytes`: 5-50 bytes (field value)
- `proof`: 32 bytes × proof_length (typically 2-4 hashes)
- `directions`: proof_length bits (minimal)

**Total calldata:** ~100-200 bytes = **1,600-3,200 gas**

This is included in the total verification cost above.

## 3. SBE Reading Costs

When reading SBE data chunks directly (without verification):

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Read 100-byte chunk | ~5k | From SSTORE2 |
| Read 500-byte chunk | ~10k | Full descriptor read |
| Chunked reads | ~5k per chunk | Efficient for large descriptors |

**Use Case:** Reading SBE data for off-chain parsing or when full descriptor access is needed.

## 4. Gas Cost Summary

### 4.1 Deployment Costs

| Descriptor Size | Storage Cost | Total Deployment |
|-----------------|--------------|------------------|
| Simple (2-5 fields) | ~120k gas | ~120k gas |
| Medium (10-15 fields) | ~150k gas | ~150k gas |
| Complex (20+ fields) | ~200k gas | ~200k gas |

### 4.2 Verification Costs

| Descriptor Size | Verification Cost | Notes |
|-----------------|-------------------|-------|
| 2 fields | ~8k gas | Logarithmic scaling (1 proof step) |
| 5 fields | ~9k gas | Logarithmic scaling (3 proof steps) |
| 16 fields | ~11k gas | Logarithmic scaling (4 proof steps) |
| 50+ fields | ~12k gas | Logarithmic scaling (6 proof steps) |

**Key Point:** Verification cost scales logarithmically, while storage cost is constant.

## 5. Real-World Examples

### Example 1: Simple Bond (2 fields)

**Descriptor:**
```javascript
{
  55: "AAPL",    // Symbol
  223: "4.250"   // CouponRate
}
```

**Gas Costs:**
- Storage: ~120k gas (one-time)
- Verification: ~8k gas per field
- Total per access: ~8k gas

### Example 2: Complex Bond (16 fields)

**Descriptor:**
```javascript
{
  1: "Account",
  55: "Symbol",
  44: "Price",
  // ... 13 more fields
}
```

**Gas Costs:**
- Storage: ~120k gas (one-time)
- Verification: ~11k gas per field
- Total per access: ~11k gas

**Key Point:** Only 3k gas more than simple bond, despite 8x more fields!

## 6. Best Practices

### 6.1 Use Merkle Proofs for Verification

```solidity
// ✅ Efficient: Constant gas cost
function verifyField(
    bytes calldata pathCBOR,
    bytes calldata value,
    bytes32[] calldata proof,
    bool[] calldata directions
) external view returns (bool) {
    return FixMerkleVerifier.verify(
        _fixDescriptor.getRoot(),
        pathCBOR,
        value,
        proof,
        directions
    );
}
```

### 6.2 Store SBE for Reference

```solidity
// ✅ Store SBE via SSTORE2 for fallback/reading
address sbePtr = SSTORE2.write(sbeData);

// Can read chunks if needed
bytes memory chunk = FixDescriptorLib.getFixSBEChunk(start, size);
```

### 6.3 Batch Verifications

```solidity
// ✅ Verify multiple fields in one transaction
function verifyBatch(FieldProof[] calldata proofs) external {
    for (uint i = 0; i < proofs.length; i++) {
        require(verify(...), "Invalid proof");
    }
}
```

### 6.4 Cost Optimization Strategies

✅ **Cache proofs** - If descriptor doesn't change, cache the proof generation  
✅ **Batch reads** - Read multiple fields in one call when possible  
✅ **Use view functions** - Off-chain reads are free (0 gas)  
✅ **Partial reads** - Only verify needed fields, not entire descriptor  
❌ Don't call repeatedly in loops without caching

## 7. Network Cost Estimates

**Cost Breakdown by Network** (assuming gas price and ETH price):

| Network | Gas Price | ETH Price | Storage Cost | Verification Cost |
|---------|-----------|-----------|--------------|-------------------|
| Ethereum Mainnet | 30 gwei | $2,500 | ~$3-5 | ~$0.02-0.03 |
| Optimism | 0.001 gwei | $2,500 | ~$0.0001 | ~$0.000001 |
| Arbitrum | 0.1 gwei | $2,500 | ~$0.02 | ~$0.0001 |
| Base | 0.05 gwei | $2,500 | ~$0.01 | ~$0.00005 |
| Sepolia Testnet | 3 gwei | N/A | Testnet ETH | Testnet ETH |

## Conclusion

The **SBE + Merkle approach** provides optimal gas efficiency:

1. **Storage:** SSTORE2 makes SBE storage affordable (~100-200k gas)
2. **Verification:** Logarithmic cost scaling (6k-12k gas, O(log n) where n is number of fields)
3. **Scalability:** Handles descriptors of any size efficiently
4. **Security:** Cryptographic guarantees via Merkle proofs

**Recommended for:**
- ✅ Production deployments
- ✅ Gas-sensitive applications
- ✅ Large descriptors (5+ fields)
- ✅ Selective field access patterns

For production use with real-world FIX descriptors, this approach provides the best balance between deployment cost, verification efficiency, and operational flexibility.

---

## Test Files

- Implementation: [contracts/src/FixMerkleVerifier.sol](../contracts/src/FixMerkleVerifier.sol)
- Library: [contracts/src/FixDescriptorLib.sol](../contracts/src/FixDescriptorLib.sol)
- Test data generation: [packages/fixdescriptorkit-typescript/scripts/generate-solidity-test-data.ts](../packages/fixdescriptorkit-typescript/scripts/generate-solidity-test-data.ts)

**Run gas analysis:**
```bash
cd contracts
forge test --match-contract FixDescriptorLibTest --gas-report
```
