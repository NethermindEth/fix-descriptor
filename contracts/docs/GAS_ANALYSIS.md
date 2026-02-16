# Gas Analysis: SBE + Merkle Verification

## Executive Summary

**Approach:** Store SBE-encoded descriptors via SSTORE2 and use Merkle proof verification for field access.

**Key Benefits:**
- **Efficient storage:** SSTORE2 makes SBE storage affordable (~100-200k gas)
- **Logarithmic verification cost:** 6k-12k gas per field verification (scales as O(log n) where n is number of fields)
- **Scalable:** Handles descriptors with 50+ fields efficiently
- **Cryptographic security:** Merkle proofs ensure field authenticity

## Gas Performance

### Verification Costs

| Descriptor Size | Merkle Verification | Proof Length | Notes |
|-----------------|---------------------|--------------|-------|
| 2 fields | ~6k gas | 1 hash | Minimal overhead |
| 5 fields | ~6-8k gas | 3 hashes | Still efficient |
| 16 fields | ~8.5k gas | 4 hashes | Logarithmic scaling |
| Nested groups | ~7.7k gas | 2-3 hashes | Same as top-level |

**Key Insight:** Gas cost scales logarithmically with descriptor size - proof length grows as log₂(number of fields), making it highly efficient even for large descriptors.

### Storage Costs

| Component | Size | Gas Cost | Notes |
|-----------|------|----------|-------|
| Merkle root | 32 bytes | ~20k | One-time storage slot |
| SBE via SSTORE2 | ~500 bytes typical | ~100-200k | One-time deployment |
| SBE pointer | 20 bytes (address) | Included in descriptor | Storage slot reference |

**Total deployment cost:** ~120-220k gas (one-time)

### SBE Reading Costs

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Read 100-byte chunk | ~5k | From SSTORE2 |
| Read 500-byte chunk | ~10k | Full descriptor read |
| Chunked reads | ~5k per chunk | Efficient for large descriptors |

## Detailed Breakdown

### Merkle Proof Verification

**Formula:** `gas ≈ 6k + (proof_length × 500)`

Where `proof_length = log₂(num_leaves)`

**Breakdown:**
- Base cost: ~6k gas (leaf hash computation, loop overhead)
- Per proof step: ~500 gas (keccak256 hash + memory operations)
- Calldata: ~1.6k-3.2k gas (100-200 bytes at 16 gas/byte)

**Example:**
- 2 fields: 1 proof step = ~6k + 500 + 1.6k = **~8.1k gas total**
- 16 fields: 4 proof steps = ~6k + 2000 + 3.2k = **~11.2k gas total**

### Storage Cost Analysis

#### Option: SBE + Merkle Root (Current Implementation)

**Storage:**
- Merkle root: 32 bytes = **20,000 gas** (one-time)
- SBE via SSTORE2: ~500 bytes = **100,000-200,000 gas** (one-time)
- Total: **~120-220k gas**

**Verification:**
- Per field: **6k-12k gas** (logarithmic scaling: O(log n))
- Plus calldata: **1.6k-3.2k gas**
- **Total per access: ~8-12k gas**

**Pros:**
- ✅ Efficient storage with SSTORE2
- ✅ Logarithmic verification cost scaling (very efficient)
- ✅ Can read SBE data if needed
- ✅ Cryptographic guarantees

**Cons:**
- Requires proof generation offchain
- Cannot enumerate fields without proofs

## Key Insights

### 1. Logarithmic Verification Cost

Merkle proof verification has **logarithmic gas cost scaling** (O(log n)) with descriptor size:
- Small descriptor (2 fields): ~6k gas (1 proof step)
- Large descriptor (16 fields): ~8.5k gas (4 proof steps)
- Very large descriptor (50+ fields): ~12k gas (6 proof steps)

The cost grows slowly because proof length grows logarithmically: log₂(2) = 1, log₂(16) = 4, log₂(50) ≈ 6. This means doubling the number of fields only adds ~500 gas per additional proof step.

### 2. SSTORE2 Makes SBE Storage Affordable

Traditional SSTORE would cost:
- 500 bytes × 20,000 gas/byte = **10,000,000 gas** ❌

SSTORE2 (bytecode storage) costs:
- ~100 gas base + ~200 gas/byte × 500 = **~100,000 gas** ✅

**Savings: 100x cheaper!**

### 3. Proof Calldata Overhead

Each verification requires proof data in calldata:
- `pathCBOR`: ~10-20 bytes (CBOR-encoded path)
- `valueBytes`: 5-50 bytes (field value)
- `proof`: 32 bytes × proof_length (typically 2-4 hashes)
- `directions`: proof_length bits (minimal)

**Total calldata:** ~100-200 bytes = **1,600-3,200 gas**

This is included in the total verification cost above.

## Gas Savings Summary

| Descriptor Size | Verification Cost | Storage Cost | Total Deployment |
|-----------------|-------------------|--------------|------------------|
| 2 fields | ~8k gas | ~120k gas | ~128k gas |
| 5 fields | ~9k gas | ~120k gas | ~129k gas |
| 16 fields | ~11k gas | ~120k gas | ~131k gas |
| 50+ fields | ~12k gas | ~120k gas | ~132k gas |

**Key Point:** Verification cost scales logarithmically, while storage cost is constant.

## Comparison with Alternatives

### vs Direct SBE Parsing (Theoretical)

If we were to parse SBE directly onchain:
- **Storage:** Same (~100-200k gas via SSTORE2)
- **Verification:** Would require parsing entire SBE structure
- **Cost:** Would scale with descriptor size (O(n) or O(log n) with binary search)
- **Estimated:** 20k-100k+ gas depending on descriptor size

**Merkle advantage:** Logarithmic scaling (6k-12k gas) vs linear scaling (20k-100k+ gas)

### vs Storing Full Descriptor in Storage

If we stored descriptor in regular storage:
- **Storage:** 500 bytes × 20,000 gas/byte = **10,000,000 gas** ❌
- **Reading:** Still need parsing logic
- **Total:** Prohibitively expensive

**SSTORE2 advantage:** 100x cheaper storage

## Best Practices

### 1. Use Merkle Proofs for Verification

```solidity
// ✅ Efficient: Logarithmic gas cost scaling
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

### 2. Store SBE for Reference

```solidity
// ✅ Store SBE via SSTORE2 for fallback/reading
address sbePtr = SSTORE2.write(sbeData);

// Can read chunks if needed
bytes memory chunk = FixDescriptorLib.getFixSBEChunk(start, size);
```

### 3. Batch Verifications

```solidity
// ✅ Verify multiple fields in one transaction
function verifyBatch(FieldProof[] calldata proofs) external {
    for (uint i = 0; i < proofs.length; i++) {
        require(verify(...), "Invalid proof");
    }
}
```

## Real-World Examples

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

- Implementation: [contracts/src/FixMerkleVerifier.sol](../src/FixMerkleVerifier.sol)
- Library: [contracts/src/FixDescriptorLib.sol](../src/FixDescriptorLib.sol)
- Test data generation: [packages/fixdescriptorkit-typescript/scripts/generate-solidity-test-data.ts](../../packages/fixdescriptorkit-typescript/scripts/generate-solidity-test-data.ts)
- Generated test data: [contracts/src/generated/GeneratedMerkleData.sol](../src/generated/GeneratedMerkleData.sol)

**Run gas analysis:**
```bash
forge test --root contracts --match-contract FixDescriptorLibTest --gas-report
```

**Regenerate test data:**
```bash
cd packages/fixdescriptorkit-typescript
npm run generate-test-data
```
