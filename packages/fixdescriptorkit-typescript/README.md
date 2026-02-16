# FixDescriptorKit TypeScript Library

> **Core library for transforming FIX asset descriptors into canonical trees and Merkle commitments**

A TypeScript library that provides the fundamental building blocks for converting FIX (Financial Information eXchange) protocol messages into deterministic, verifiable onchain commitments.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-green.svg)](https://vitest.dev/)

## 📦 What This Library Does

This is the **core transformation engine** for FixDescriptorKit. It handles:

1. **FIX Message Parsing** - Convert FIX protocol messages to structured trees
2. **Canonicalization** - Transform trees into deterministic, sorted representations
3. **Merkle Tree Generation** - Create cryptographic commitments with proof support
4. **Type Safety** - Fully typed API with runtime validation

**Note:** This library generates canonical trees and Merkle proofs. For onchain storage, the canonical tree is encoded using SBE (Simple Binary Encoding) via the SBE encoder service. 

**CBOR Usage:** The library uses CBOR encoding internally for **Merkle path encoding only**. Specifically:
- The `encodePathCBOR()` function (internal) uses the `cbor-x` library to encode path arrays (e.g., `[15]` → `0x811837`, `[454, 0, 455]` → CBOR bytes)
- These CBOR-encoded paths are used in Merkle leaf computation: `keccak256(pathCBOR || "=" || valueBytes)`
- The canonical tree itself is a JavaScript object, not CBOR-encoded

## 🎯 Use Cases

- **Blockchain Applications** - Prepare FIX descriptors for onchain storage
- **Financial Infrastructure** - Bridge traditional finance with blockchain
- **Data Verification** - Generate proofs for specific descriptor fields
- **Development Tools** - Build applications that work with FIX descriptors
- **Testing & Validation** - Verify descriptor transformations

## 📥 Installation

From the monorepo root:

```bash
npm install
cd packages/fixdescriptorkit-typescript
npm run build
```

## 🚀 Quick Start

```typescript
import {
  parseFixDescriptor,
  buildCanonicalTree,
  enumerateLeaves,
  computeRoot,
  generateProof,
  verifyProof
} from 'fixdescriptorkit-typescript';

// 1. Parse FIX message
const fixMessage = "8=FIX.4.4|55=USTB-2030-11-15|167=TBOND|223=4.250|15=USD";
const tree = parseFixDescriptor(fixMessage);

// 2. Build canonical tree (sorted, deterministic)
const canonical = buildCanonicalTree(tree);

// 3. Generate Merkle commitment
const leaves = enumerateLeaves(canonical);
const merkleRoot = computeRoot(leaves);
console.log(`Merkle root: ${merkleRoot}`);

// 4. Generate proof for a specific field
const currencyPath = [15]; // FIX tag 15 = Currency
const proof = generateProof(leaves, currencyPath);
console.log(`Proof for Currency field:`, proof);

// 5. Verify the proof
const isValid = verifyProof(merkleRoot, currencyPath, "USD", proof, leaves);
console.log(`Proof valid: ${isValid}`);
```

## 📚 API Reference

### Core Functions

#### `parseFixDescriptor(fixRaw: string): DescriptorTree`

Parses a FIX protocol message into a structured tree representation.

**Parameters:**
- `fixRaw` - Pipe-delimited FIX message (e.g., `"8=FIX.4.4|55=ACME|15=USD"`)

**Returns:**
- `DescriptorTree` - Hierarchical representation with scalars and groups

**Example:**
```typescript
const tree = parseFixDescriptor("55=ACME|167=CORP|15=USD");
// Returns:
// {
//   scalars: {
//     55: "ACME",
//     167: "CORP",
//     15: "USD"
//   },
//   groups: {}
// }
```

**Notes:**
- Automatically filters out session/transport fields (tags 8, 9, 10, etc.)
- Handles repeating groups (e.g., 453=Parties, 454=SecurityAltID)
- Preserves group entry order

---

#### `buildCanonicalTree(tree: DescriptorTree): CanonicalNode`

Converts a descriptor tree into canonical form for deterministic encoding.

**Parameters:**
- `tree` - Parsed descriptor tree

**Returns:**
- `CanonicalNode` - Canonical representation with:
  - Integer keys (FIX tags)
  - Sorted map keys
  - Array values for groups
  - String values for scalars

**Example:**
```typescript
const canonical = buildCanonicalTree(tree);
// Returns:
// {
//   15: "USD",
//   55: "ACME",
//   167: "CORP"
// }
// Note: Keys are sorted (15, 55, 167)
```

**Guarantees:**
- **Deterministic**: Same input → same output
- **Sorted**: All map keys in ascending order
- **Canonical**: Single valid representation per descriptor

---

#### `enumerateLeaves(node: CanonicalNode): MerkleLeaf[]`

Enumerates all fields in the canonical tree as Merkle leaves.

**Parameters:**
- `node` - Canonical tree

**Returns:**
- `MerkleLeaf[]` - Array of leaves, each containing:
  - `path` - Array of integers identifying field location
  - `pathCBOR` - CBOR-encoded path (for hashing)
  - `value` - Field value as string
  - `hash` - keccak256(pathCBOR || "=" || valueBytes)

**Example:**
```typescript
const leaves = enumerateLeaves(canonical);
// Returns:
// [
//   {
//     path: [15],
//     pathCBOR: Uint8Array([0x81, 0x0f]),
//     value: "USD",
//     hash: "0xa1b2c3..."
//   },
//   {
//     path: [55],
//     pathCBOR: Uint8Array([0x81, 0x37]),
//     value: "ACME",
//     hash: "0xd4e5f6..."
//   },
//   // ... more leaves
// ]
```

**Path Format:**
- **Scalar**: `[tag]` - e.g., `[15]` for Currency
- **Group Field**: `[groupTag, index, fieldTag]` - e.g., `[453, 0, 448]` for first Party's PartyID
- **Nested Group**: `[tag1, idx1, tag2, idx2, ...]` - recursive structure

---

#### `computeRoot(leaves: MerkleLeaf[]): string`

Computes the Merkle root hash from enumerated leaves.

**Parameters:**
- `leaves` - Array of Merkle leaves from `enumerateLeaves()`

**Returns:**
- `string` - Merkle root hash (0x-prefixed hex string)

**Example:**
```typescript
const root = computeRoot(leaves);
// Returns: "0x7a3f9c2e..."
```

**Algorithm:**
1. Sort leaves by `pathCBOR` (CBOR-encoded path, lexicographic byte order)
2. Build binary Merkle tree:
   - Pair adjacent leaves
   - Parent = keccak256(left || right)
   - If odd node, promote to next level (no duplicate hashing)
3. Return final root hash

**Note:** The `pathCBOR` field in leaves uses CBOR encoding for the path array. When used onchain, this is passed as `pathCBOR` to the `verifyField` function.

---

#### `generateProof(leaves: MerkleLeaf[], targetPath: number[]): MerkleProof`

Generates a cryptographic proof for a specific field.

**Parameters:**
- `leaves` - All leaves from `enumerateLeaves()`
- `targetPath` - Path to the field (e.g., `[15]` for Currency, `[453, 0, 448]` for group field)

**Returns:**
- `MerkleProof` - Object containing:
  - `proof` - Array of sibling hashes (bytes32[])
  - `directions` - Array of booleans (false=left, true=right)
  - `leaf` - The leaf hash being proved

**Example:**
```typescript
const proof = generateProof(leaves, [15]); // Prove Currency field
// Returns:
// {
//   proof: ["0x1a2b3c...", "0x4d5e6f...", "0x7a8b9c..."],
//   directions: [false, true, false],
//   leaf: "0xa1b2c3..."
// }
```

**Usage:**
- Pass to smart contract `verifyField()` function
- Enables onchain verification without revealing full descriptor

---

#### `verifyProof(root: string, path: number[], value: string, proof: MerkleProof, leaves: MerkleLeaf[]): boolean`

Verifies a Merkle proof against a root hash.

**Parameters:**
- `root` - Expected Merkle root
- `path` - Field path (e.g., `[15]`)
- `value` - Expected field value (e.g., `"USD"`)
- `proof` - Proof from `generateProof()`
- `leaves` - All leaves (for path encoding)

**Returns:**
- `boolean` - `true` if proof is valid

**Example:**
```typescript
const isValid = verifyProof(root, [15], "USD", proof, leaves);
console.log(`Proof valid: ${isValid}`); // true
```

**Verification Process:**
1. Compute leaf hash: `keccak256(pathCBOR || "=" || valueBytes)`
2. Walk proof tree using sibling hashes and directions
3. Compare final computed root with expected root

## 📂 Module Structure

```
src/
├── index.ts           # Main exports
├── types.ts           # TypeScript type definitions
├── parse.ts           # FIX message parsing
│   └── parseFixDescriptor()
├── canonical.ts       # Tree canonicalization
│   └── buildCanonicalTree()
├── merkle.ts          # Merkle tree operations
│   ├── enumerateLeaves()
│   ├── computeRoot()
│   ├── generateProof()
│   └── verifyProof()
└── test/              # Unit tests
    ├── parse.test.ts
    ├── canonical.test.ts
    └── merkle.test.ts
```

## 🔧 Type Definitions

### Core Types

```typescript
// Raw descriptor tree from parser
interface DescriptorTree {
  scalars: Record<number, string>;           // tag → value
  groups: Record<number, GroupEntry[]>;      // groupTag → entries
}

// Group entry (repeating structure)
interface GroupEntry {
  scalars: Record<number, string>;
  groups?: Record<number, GroupEntry[]>;     // Nested groups
}

// Canonical node (deterministic representation)
type CanonicalNode = {
  [tag: number]: string | CanonicalNode[];   // Scalar or array of nodes
};

// Merkle leaf
interface MerkleLeaf {
  path: number[];                            // Field path
  pathCBOR: Uint8Array;                      // CBOR-encoded path
  value: string;                             // Field value
  hash: string;                              // keccak256(pathCBOR || "=" || value)
}

// Merkle proof
interface MerkleProof {
  proof: string[];                           // Sibling hashes (bytes32[])
  directions: boolean[];                     // false=left, true=right
  leaf: string;                              // Leaf hash
}
```

## 🧪 Testing

```bash
# Run tests
npm test

# Watch mode for development
npm run dev:test

# With coverage
npm test -- --coverage
```

**Test Requirements:**
- Set `FIXPARSER_LICENSE_KEY` environment variable
- Tests cover all core functions with edge cases
- Integration tests verify end-to-end pipeline

## 🔍 Examples

### Example 1: Simple Descriptor

```typescript
import { parseFixDescriptor, buildCanonicalTree } from 'fixdescriptorkit-typescript';

const fix = "55=ACME|48=US000000AA11|167=CORP|15=USD";
const tree = parseFixDescriptor(fix);
const canonical = buildCanonicalTree(tree);

console.log(JSON.stringify(canonical, null, 2));
// {
//   "15": "USD",
//   "48": "US000000AA11",
//   "55": "ACME",
//   "167": "CORP"
// }
```

### Example 2: Descriptor with Groups

```typescript
const fix = "55=ACME|453=[{448=ISSUER,452=1},{448=CUSTODIAN,452=24}]";
const tree = parseFixDescriptor(fix);
const canonical = buildCanonicalTree(tree);

console.log(JSON.stringify(canonical, null, 2));
// {
//   "55": "ACME",
//   "453": [
//     { "448": "ISSUER", "452": "1" },
//     { "448": "CUSTODIAN", "452": "24" }
//   ]
// }
```

### Example 3: Generate Proof for Group Field

```typescript
const leaves = enumerateLeaves(canonical);
const partyIDPath = [453, 0, 448]; // First party's PartyID
const proof = generateProof(leaves, partyIDPath);

console.log(`Proving path [453, 0, 448] = "ISSUER"`);
console.log(`Proof length: ${proof.proof.length} hashes`);
console.log(`Directions: ${proof.directions}`);
```
## 🔐 Security Considerations

### Deterministic Encoding

All functions produce deterministic output:
- **Sorting**: Map keys always sorted
- **Path encoding**: Canonical CBOR for Merkle paths (RFC 8949)
- **Hashing**: keccak256 (Ethereum-compatible)

This ensures:
- Multiple implementations produce identical results
- Onchain verification matches off-chain generation
- No ambiguity in representation

### Validation

The library performs validation at multiple levels:
- FIX parsing validates message structure
- Type checking ensures correct data types
- Merkle verification confirms proof integrity

### Trust Model

This library is **computation only** - it does not:
- Validate FIX business logic
- Verify real-world accuracy of descriptor data
- Check ISIN validity or other external data

These are application-level concerns.

## 🛠️ Development

### Building

```bash
npm run build
```

Output: `dist/` directory with compiled JavaScript and TypeScript declarations.

### Project Structure

- **Source**: `src/` - TypeScript source files
- **Tests**: `test/` - Vitest unit tests
- **Output**: `dist/` - Compiled JavaScript (gitignored)

### Dependencies

- **fixparser** - FIX protocol parsing (requires license key for testing)
- **cbor-x** - CBOR path encoding for Merkle leaves
- **viem** - Ethereum utilities (keccak256 hashing)
- **zod** - Runtime type validation
- **vitest** - Testing framework

## 📄 Related Documentation

- **Main Repository**: [FixDescriptorKit](../../README.md)
- **Technical Spec**: [Web Specification](https://fixdescriptor.vercel.app/spec)
- **Web App**: [apps/web](../../apps/web/README.md)
- **Smart Contracts**: [contracts](../../contracts/README.md)

## 🤝 Contributing

Contributions welcome! To add features or fix bugs:

1. Fork the repository
2. Create a feature branch
3. Add/update tests
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

ISC License

---

**Built for blockchain-based financial infrastructure**
