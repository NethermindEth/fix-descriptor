# FIX Merkle Verifier

## Overview

The FIX Merkle Verifier enables gas-efficient verification of FIX Descriptor fields using Merkle proofs. Instead of storing the full SBE descriptor onchain, only a 32-byte Merkle root is stored, and individual fields are verified with cryptographic proofs.

## Why Merkle Proofs?

**Gas Comparison:**
- Direct field parsing (SBE/CBOR): **12k - 80k gas** (scales with descriptor size)
- Merkle proof verification: **6k - 8.5k gas** (constant regardless of size)

**Savings: 2-10x cheaper** ✅

See [GAS_COMPARISON_ANALYSIS.md](GAS_COMPARISON_ANALYSIS.md) for detailed analysis.

## Architecture

### Merkle Tree Structure

**Leaf Computation:**
```
leaf = keccak256(pathCBOR || "=" || valueBytes)
```

Where:
- `pathCBOR`: CBOR-encoded path array (e.g., `[55]` encoded as `0x811837` or `[454, 0, 455]`)
- `valueBytes`: UTF-8 encoded field value

**Note:** The path array is CBOR-encoded for canonical representation.

**Parent Computation:**
```
parent = keccak256(leftChild || rightChild)
```

**Odd Nodes:**
- Promoted to next level unchanged (no hashing with self)

### Example Tree

**Descriptor:**
```javascript
{
  55: "AAPL",
  223: "4.250"
}
```

**Leaves (sorted by pathCBOR bytes):**
```
Leaf 0: keccak256(pathCBOR([55]) || "=" || "AAPL")    = 0x5f1c...
Leaf 1: keccak256(pathCBOR([223]) || "=" || "4.250")  = 0x1d71...
```

**Root:**
```
Root: keccak256(Leaf 0 || Leaf 1) = 0xc5e9...
```

## Implementation

### FixMerkleVerifier.sol

**Location:** [src/FixMerkleVerifier.sol](../src/FixMerkleVerifier.sol)

```solidity
library FixMerkleVerifier {
    /// @notice Verify a Merkle proof for a FIX field
    /// @param root The Merkle root stored onchain
    /// @param pathCBOR CBOR-encoded bytes of the path array (e.g., [55] → 0x811837)
    /// @param value UTF-8 encoded field value
    /// @param proof Array of sibling hashes
    /// @param directions Array of booleans: true if current node is right child
    /// @return ok True if proof is valid
    function verify(
        bytes32 root,
        bytes memory pathCBOR,
        bytes memory value,
        bytes32[] memory proof,
        bool[] memory directions
    ) internal pure returns (bool ok) {
        // 1. Compute leaf hash
        bytes32 node = keccak256(abi.encodePacked(pathCBOR, "=", value));

        // 2. Walk up the tree
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            bool isRight = directions[i];

            if (isRight) {
                // Current node is right child: parent = keccak(sibling || node)
                node = keccak256(abi.encodePacked(sibling, node));
            } else {
                // Current node is left child: parent = keccak(node || sibling)
                node = keccak256(abi.encodePacked(node, sibling));
            }
        }

        // 3. Check if computed root matches stored root
        return node == root;
    }
}
```

## Usage Patterns

### Pattern 1: Store Merkle Root

```solidity
contract FixDescriptorRegistry {
    // Store only the 32-byte root (20k gas storage)
    mapping(bytes32 => bytes32) public descriptorRoots; // tokenId => root

    function setDescriptor(bytes32 tokenId, bytes32 merkleRoot) external {
        descriptorRoots[tokenId] = merkleRoot;
    }
}
```

**vs SBE Storage:**
```solidity
// Storing 500-byte SBE via SSTORE2: ~100-200k gas ✅
// But Merkle root is still cheaper for verification!
mapping(bytes32 => bytes) public descriptors;
```

### Pattern 2: Verify and Access Field

```solidity
function getVerifiedField(
    bytes32 tokenId,
    bytes calldata pathCBOR,
    bytes calldata valueBytes,
    bytes32[] calldata proof,
    bool[] calldata directions
) external view returns (string memory) {
    bytes32 root = descriptorRoots[tokenId];
    require(root != bytes32(0), "Descriptor not found");

    require(
        FixMerkleVerifier.verify(root, pathCBOR, valueBytes, proof, directions),
        "Invalid Merkle proof"
    );

    return string(valueBytes);
}
```

### Pattern 3: Verify Multiple Fields

```solidity
struct FieldProof {
    bytes pathCBOR;
    bytes valueBytes;
    bytes32[] proof;
    bool[] directions;
}

function verifyMultipleFields(
    bytes32 root,
    FieldProof[] calldata fields
) external pure returns (bool[] memory results) {
    results = new bool[](fields.length);

    for (uint256 i = 0; i < fields.length; i++) {
        results[i] = FixMerkleVerifier.verify(
            root,
            fields[i].pathCBOR,
            fields[i].valueBytes,
            fields[i].proof,
            fields[i].directions
        );
    }
}
```

## Proof Generation (Offchain)

### TypeScript Implementation

**Location:** [packages/fixdescriptorkit-typescript/src/merkle.ts](../../packages/fixdescriptorkit-typescript/src/merkle.ts)

```typescript
import { enumerateLeaves, computeRoot, generateProof } from 'fixdescriptorkit-typescript';

// 1. Build descriptor tree
const descriptor = {
  55: "AAPL",
  223: "4.250",
  541: "20250615"
};

// 2. Enumerate all leaves
const leaves = enumerateLeaves(descriptor);
// [
//   { path: [55], pathCBOR: 0x811837, valueBytes: 0x4141504c },
//   { path: [223], pathCBOR: 0x8118df, valueBytes: 0x342e323530 },
//   { path: [541], pathCBOR: 0x81_19021d, valueBytes: 0x3230323530363135 }
// ]
// Note: pathCBOR field in leaves is CBOR-encoded

// 3. Compute Merkle root
const root = computeRoot(leaves);
// 0x8232e69c31129d043d92faffcfedb1b52a2d968028ec9a11614ec6c56e6a9e18

// 4. Generate proof for specific field
const proofData = generateProof(leaves, [55]); // Symbol field
// {
//   pathCBOR: Uint8Array([0x81, 0x18, 0x37]), // CBOR-encoded path
//   valueBytes: Uint8Array([0x41, 0x41, 0x50, 0x4c]),
//   proof: [
//     0xd4d372c241500d454e1e813871517302b592198279cf203bb61510a3e2cac6c0,
//     0x8985bdac9f0ac67d2bbbb5d78dfcdf65c617497a92831f910c3d81e41a5a26fc
//   ],
//   directions: [false, false]
// }
// Note: Use proofData.pathCBOR as pathCBOR parameter when calling verifyField()
```

### Client-Side Workflow

```typescript
// 1. User mints token with descriptor
const descriptor = parseFixDescriptor("55=AAPL|223=4.250|541=20250615");
const { root, cbor, leaves } = encodeAll(descriptor);

// 2. Store root onchain (cheap: 20k gas)
await contract.setDescriptor(tokenId, root);

// 3. When reading a field, generate proof offchain
const proof = generateProof(leaves, [55]); // Symbol

// 4. Verify onchain (cheap: 6-8k gas)
const value = await contract.getVerifiedField(
  tokenId,
  proof.pathCBOR, // Pass as pathCBOR parameter (CBOR-encoded path bytes)
  proof.valueBytes,
  proof.proof,
  proof.directions
);
```

## Gas Costs

### Detailed Breakdown

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Store Merkle root | 20k gas | One-time, 32 bytes (1 slot) |
| Verify 2-field descriptor | 6k gas | 1 proof step (1 sibling) |
| Verify 5-field descriptor | 7-8k gas | 3 proof steps (3 siblings) |
| Verify 16-field descriptor | 8.5k gas | 4 proof steps (4 siblings) |
| Verify nested group field | 7.7k gas | Same as top-level |

**Formula:** `gas ≈ 6k + (proof_length × 500)`

Where `proof_length = log₂(num_leaves)`

### vs CBOR Storage

| Descriptor | CBOR Storage | Merkle Storage | Savings |
|------------|--------------|----------------|---------|
| 2 fields | 10M gas | 20k gas | **500x cheaper** ✅ |
| 16 fields | 10M gas | 20k gas | **500x cheaper** ✅ |

| Field Access | CBOR Gas | Merkle Gas | Savings |
|--------------|----------|------------|---------|
| 2 fields | 12-17k | 6k | **2-3x cheaper** |
| 16 fields | 46-80k | 8.5k | **5-9x cheaper** ✅ |

## Security Considerations

### 1. Proof Validity

✅ **Guaranteed:** If proof verifies, the field value is authentic
❌ **Not guaranteed:** Completeness (can't prove field doesn't exist)

### 2. Path Collisions

The pathCBOR is part of the leaf hash, preventing:
- Different paths with same value from colliding
- Path substitution attacks

### 3. Value Integrity

The entire value bytes are hashed, ensuring:
- No partial value attacks
- No value modification attacks

### 4. Root Storage

⚠️ **Critical:** Protect root storage with proper access control
```solidity
function setDescriptor(bytes32 tokenId, bytes32 root) external onlyOwner {
    descriptorRoots[tokenId] = root;
}
```

## Testing

### Unit Tests

**File:** [test/GasComparison.t.sol](../test/GasComparison.t.sol)

25 tests comparing Merkle vs CBOR for all test cases.

Run tests:
```bash
forge test --match-contract GasComparisonTest --gas-report
```

### Test Data Generation

All Merkle proofs are auto-generated from TypeScript:

**File:** [src/generated/GeneratedMerkleData.sol](../src/generated/GeneratedMerkleData.sol)

Contains:
- 6 Merkle roots (one per test case)
- 21 pre-generated proofs for commonly accessed fields

Regenerate:
```bash
cd packages/fixdescriptorkit-typescript
npm run generate-test-data
```

## Best Practices

### 1. Store Root, Not CBOR

```solidity
// ✅ Good: 20k gas storage
mapping(uint256 => bytes32) public roots;

// ❌ Bad: 10M gas storage
mapping(uint256 => bytes) public descriptors;
```

### 2. Verify Offchain First

```typescript
// ✅ Catch errors before sending transaction
const isValid = verifyProofLocal(root, pathCBOR, value, proof, directions);
if (!isValid) throw new Error("Invalid proof");

await contract.verifyOnchain(...);
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

### 4. Cache Roots Offchain

```typescript
// ✅ Store full descriptor + root in database
const data = {
  tokenId,
  root: "0x8232e69c...",
  descriptor: { 55: "AAPL", ... },
  leaves: [...]  // For proof generation
};
```

## Limitations

1. **Proof Size** - Grows with log₂(fields), adds calldata cost
2. **Proof Generation** - Requires offchain computation
3. **No Enumeration** - Can't list all fields onchain (need CBOR for that)
4. **Client Complexity** - Clients must generate/verify proofs

## Recommendation

**Use Merkle roots when:**
- ✅ Large descriptors (10+ fields)
- ✅ Infrequent field access
- ✅ Storage cost is critical
- ✅ Selective disclosure needed

**Use CBOR when:**
- ⚠️ Very small descriptors (2-3 fields)
- ⚠️ Frequent access to ALL fields
- ⚠️ Onchain enumeration required

For most production use cases, **Merkle roots are the clear winner** (2-10x gas savings).

## Further Reading

- [Gas Comparison Analysis](GAS_COMPARISON_ANALYSIS.md) - Detailed cost breakdown
- [TypeScript Implementation](../../packages/fixdescriptorkit-typescript/src/merkle.ts)
- [Merkle Tree Specification](https://en.wikipedia.org/wiki/Merkle_tree)
