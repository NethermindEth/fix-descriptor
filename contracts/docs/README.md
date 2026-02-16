# FIX Descriptor Contracts Documentation

Comprehensive documentation for the FIX Descriptor EVM contracts.

## Quick Start

**New to the project?** Start here:

1. 📖 [BUILD_AND_TEST.md](BUILD_AND_TEST.md) - Setup, build, and test instructions
2. 📖 [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) - Step-by-step integration guide
3. 📊 [GAS_ANALYSIS.md](GAS_ANALYSIS.md) - Gas cost analysis
4. 🔐 [MERKLE_VERIFIER.md](MERKLE_VERIFIER.md) - Merkle proof verification guide ⭐

## Documentation Index

### Getting Started

| Document | Description | Audience |
|----------|-------------|----------|
| [BUILD_AND_TEST.md](BUILD_AND_TEST.md) | Build, test, and development workflow | Developers |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integration guide for token contracts | Developers |
| [../README.md](../README.md) | Project overview and quick start | Everyone |

### Technical Guides

| Document | Description | Gas Cost |
|----------|-------------|----------|
| [MERKLE_VERIFIER.md](MERKLE_VERIFIER.md) | Merkle proof field verification | 6k-8.5k gas ⭐ |
| [GAS_ANALYSIS.md](GAS_ANALYSIS.md) | Detailed gas cost analysis | - |

### Implementation Details

| Document | Description |
|----------|-------------|
| [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | Complete implementation overview |

## Architecture Overview

### SBE + Merkle Verification Approach

The project implements a **gas-efficient approach** for accessing FIX Descriptor fields onchain:

#### How It Works

1. **SBE Encoding**: Descriptors are encoded using Simple Binary Encoding (SBE)
2. **SSTORE2 Storage**: SBE data is stored efficiently via SSTORE2 (~100-200k gas)
3. **Merkle Root**: A 32-byte Merkle root is stored onchain (~20k gas)
4. **Proof Verification**: Fields are verified using Merkle proofs (6k-8.5k gas)

**Pros:**
- ✅ **Efficient storage** - SSTORE2 makes SBE storage affordable
- ✅ **Constant verification cost** - 6k-8.5k gas regardless of descriptor size
- ✅ **Scales to any size** - Handles descriptors with 50+ fields efficiently
- ✅ **Selective disclosure** - Verify specific fields without revealing all data
- ✅ **Cryptographic security** - Merkle proofs provide authenticity guarantees

**Best for:**
- Production deployments ⭐
- Large descriptors (5+ fields)
- Gas-sensitive applications
- Selective field access patterns

**Documentation:** [MERKLE_VERIFIER.md](MERKLE_VERIFIER.md)

### Gas Performance Summary

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| **Storage (Merkle root)** | 20k | One-time, 32 bytes |
| **Storage (SBE via SSTORE2)** | 100-200k | One-time, ~500 bytes typical |
| **Verification (2 fields)** | 6k | Constant cost |
| **Verification (16 fields)** | 8.5k | Constant cost |
| **Nested group verification** | 7.7k | Same as top-level |
| **SBE chunk read** | ~5k | From SSTORE2 |

**Key Advantage:** Constant verification cost regardless of descriptor size.

See [GAS_ANALYSIS.md](GAS_ANALYSIS.md) for complete analysis.

## Contract Reference

### Core Libraries

| Contract | Description | Documentation |
|----------|-------------|---------------|
| `FixDescriptorLib.sol` | Main library for descriptor management | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| `FixMerkleVerifier.sol` | Merkle proof verification | [MERKLE_VERIFIER.md](MERKLE_VERIFIER.md) |
| `IFixDescriptor.sol` | Standard interface | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| `SSTORE2.sol` | Efficient storage utility | - |

### Example Implementations

| Contract | Description | Tests |
|----------|-------------|-------|
| `AssetTokenERC20.sol` | ERC20 with FIX descriptors | Included |
| `AssetTokenERC721.sol` | ERC721 with FIX descriptors | Included |
| `AssetTokenFactory.sol` | Token factory pattern | Included |

### Test Data (Auto-Generated)

| File | Description | Gitignored |
|------|-------------|------------|
| `generated/GeneratedMerkleData.sol` | Merkle roots + proofs | ✅ Yes |

**To regenerate:**
```bash
cd packages/fixdescriptorkit-typescript
npm run generate-test-data
```

## Test Coverage

### Test Suites

| Suite | Coverage |
|-------|----------|
| `FixDescriptorLibTest` | Library functionality, storage, verification |
| `AssetTokenTest` | Token integration patterns |
| `AssetTokenFactoryTest` | Factory deployment patterns |

**Run all tests:**
```bash
forge test --root contracts
```

**Run with gas report:**
```bash
forge test --root contracts --match-contract FixDescriptorLibTest --gas-report
```

See [BUILD_AND_TEST.md](BUILD_AND_TEST.md) for detailed testing guide.

## Key Findings

### ✅ **Merkle Verification for Production**

Based on comprehensive gas analysis, **Merkle proof verification is the recommended approach** for production deployments:

1. **Efficient storage** - SSTORE2 makes SBE storage affordable (~100-200k gas)
2. **Constant verification cost** - 6k-8.5k gas regardless of descriptor size
3. **Scales to large descriptors** - Handles 50+ fields efficiently
4. **Cryptographic guarantees** - Merkle proofs ensure field authenticity

### When to Use This Approach

**Use SBE + Merkle when:**
- Any descriptor with 2+ fields ⭐
- Storage cost is a concern
- Access patterns are selective
- Production deployment
- Gas optimization is important

## Development Workflow

### 1. Initial Setup

```bash
# Clone and install
git clone <repo>
cd fixdescriptorkit-evm
forge install
cd packages/fixdescriptorkit-typescript && npm install

# Generate test data
npm run generate-test-data
```

### 2. Build and Test

```bash
# Build contracts
forge build --root contracts

# Run tests
forge test --root contracts

# Gas report
forge test --root contracts --gas-report
```

### 3. Make Changes

```bash
# Edit contracts
vim contracts/src/MyContract.sol

# Run specific tests
forge test --root contracts --match-contract MyContractTest
```

See [BUILD_AND_TEST.md](BUILD_AND_TEST.md) for complete guide.

## TypeScript Integration

The TypeScript package provides:
- SBE encoding/decoding
- Merkle tree generation
- Proof generation and verification
- Test data generation

**Location:** `packages/fixdescriptorkit-typescript/`

**Key functions:**
```typescript
import {
  enumerateLeaves,
  computeRoot,
  generateProof
} from 'fixdescriptorkit-typescript';

// Generate Merkle tree
const descriptor = { 55: "AAPL", 223: "4.250" };
const leaves = enumerateLeaves(descriptor);
const root = computeRoot(leaves);

// Generate proof
const proof = generateProof(leaves, [55]); // Symbol field
```

## Further Reading

### Specifications

- [Web Specification](https://fixdescriptor.vercel.app/spec) - Complete FIX Descriptor specification (interactive)

### External Resources

- [SBE Specification](https://github.com/FIXTradingCommunity/fix-simple-binary-encoding) - Simple Binary Encoding
- [Merkle Trees](https://en.wikipedia.org/wiki/Merkle_tree)
- [Foundry Book](https://book.getfoundry.sh/)
- [FIX Protocol](https://www.fixtrading.org/)

## Contributing

When adding new features:

1. Update relevant documentation in `contracts/docs/`
2. Add tests in `contracts/test/`
3. Update gas comparison if applicable
4. Regenerate test data if test cases changed

## Questions?

- 📖 Read [BUILD_AND_TEST.md](BUILD_AND_TEST.md) for setup issues
- 📊 Read [GAS_ANALYSIS.md](GAS_ANALYSIS.md) for gas questions
- 🔍 Check [MERKLE_VERIFIER.md](MERKLE_VERIFIER.md) for implementation details
- 💡 See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for integration patterns
