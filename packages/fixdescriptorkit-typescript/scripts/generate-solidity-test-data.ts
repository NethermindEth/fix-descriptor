#!/usr/bin/env node

/**
 * Generate Solidity test data from TypeScript Merkle encoder
 * This ensures test data is consistent between TypeScript and Solidity
 *
 * Usage:
 *   npx tsx scripts/generate-solidity-test-data.ts merkle  # Generate Merkle proofs
 */

import { enumerateLeaves, computeRoot, generateProof } from '../src/index';
import type { DescriptorTree, GroupNode } from '../src/types';
import { bytesToHex } from 'viem';

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args[0]?.toLowerCase();

if (!mode || mode !== 'merkle') {
  console.error('Usage: generate-solidity-test-data.ts merkle');
  console.error('  merkle - Generate Merkle roots and proofs');
  process.exit(1);
}

// ============================================================================
// Test Case Definitions
// ============================================================================

// Test 1: Simple descriptor
const simple: DescriptorTree = {
  55: "AAPL",
  223: "4.250"
};

// Test 2: Large descriptor
const large: DescriptorTree = {
  1: "A",
  11: "B",
  55: "AAPL",
  100: "C",
  223: "4.250"
};

// Test 3: Group descriptor
const group: DescriptorTree = {
  55: "AAPL",
  454: {
    tag: 454,
    entries: [
      { 455: "US0378331005", 456: "1" },
      { 455: "037833100", 456: "2" }
    ]
  } as GroupNode
};

// Test 4: Nested group
const nested: DescriptorTree = {
  453: {
    tag: 453,
    entries: [
      {
        448: "PARTY1",
        447: "D",
        802: {
          tag: 802,
          entries: [
            { 523: "SUB1", 803: "1" },
            { 523: "SUB2", 803: "2" }
          ]
        } as GroupNode
      },
      {
        448: "PARTY2",
        447: "E"
      }
    ]
  } as GroupNode
};

// Test 5: Bond descriptor
const bond: DescriptorTree = {
  55: "US0378331005",
  223: "4.250",
  454: {
    tag: 454,
    entries: [
      { 455: "US0378331005", 456: "1" }
    ]
  } as GroupNode,
  541: "20250615"
};

// Test 6: Real-world example with more fields
const realWorld: DescriptorTree = {
  1: "ORD001",           // ClOrdID
  11: "CLO001",          // ClOrdID
  15: "USD",             // Currency
  22: "1",               // SecurityIDSource
  38: "1000",            // OrderQty
  40: "2",               // OrdType
  44: "150.50",          // Price
  54: "1",               // Side
  55: "AAPL",            // Symbol
  59: "0",               // TimeInForce
  60: "20250602-12:30:00", // TransactTime
  100: "XNAS",           // ExDestination
  167: "CS",             // SecurityType
  200: "202506",         // MaturityMonthYear
  223: "0.000",          // CouponRate
  541: "20250615"        // MaturityDate
};

interface TestCase {
  name: string;
  tree: DescriptorTree;
  comment: string;
  accessedFields?: Array<{ path: number[]; description: string }>;
}

const testCases: TestCase[] = [
  {
    name: "Simple",
    tree: simple,
    comment: 'Simple descriptor: {55: "AAPL", 223: "4.250"}',
    accessedFields: [
      { path: [55], description: "Symbol" },
      { path: [223], description: "CouponRate" }
    ]
  },
  {
    name: "Large",
    tree: large,
    comment: 'Large descriptor: {1: "A", 11: "B", 55: "AAPL", 100: "C", 223: "4.250"}',
    accessedFields: [
      { path: [1], description: "Account" },
      { path: [55], description: "Symbol" },
      { path: [223], description: "CouponRate" }
    ]
  },
  {
    name: "Group",
    tree: group,
    comment: 'Group descriptor with SecurityAltID',
    accessedFields: [
      { path: [55], description: "Symbol" },
      { path: [454, 0, 455], description: "SecurityAltID_0_ID" },
      { path: [454, 0, 456], description: "SecurityAltID_0_Source" },
      { path: [454, 1, 455], description: "SecurityAltID_1_ID" }
    ]
  },
  {
    name: "NestedGroup",
    tree: nested,
    comment: 'Nested group descriptor with Parties and SubIDs',
    accessedFields: [
      { path: [453, 0, 448], description: "Parties_0_ID" },
      { path: [453, 0, 802, 0, 523], description: "Parties_0_SubIDs_0_ID" },
      { path: [453, 0, 802, 1, 523], description: "Parties_0_SubIDs_1_ID" }
    ]
  },
  {
    name: "Bond",
    tree: bond,
    comment: 'Complete bond descriptor',
    accessedFields: [
      { path: [55], description: "Symbol" },
      { path: [223], description: "CouponRate" },
      { path: [454, 0, 455], description: "SecurityAltID_0_ID" },
      { path: [541], description: "MaturityDate" }
    ]
  },
  {
    name: "RealWorld",
    tree: realWorld,
    comment: 'Real-world descriptor with 16 fields',
    accessedFields: [
      { path: [1], description: "Account" },
      { path: [55], description: "Symbol" },
      { path: [44], description: "Price" },
      { path: [38], description: "OrderQty" },
      { path: [54], description: "Side" },
      { path: [100], description: "ExDestination" }
    ]
  }
];

// ============================================================================
// Generate Merkle Roots and Proofs
// ============================================================================

function generateMerkle() {
  const output: string[] = [];

  output.push('// SPDX-License-Identifier: MIT');
  output.push('// Auto-generated Merkle data from TypeScript');
  output.push('// Generated at: ' + new Date().toISOString());
  output.push('// Source: packages/fixdescriptorkit-typescript/scripts/generate-solidity-test-data.ts');
  output.push('');
  output.push('pragma solidity ^0.8.28;');
  output.push('');
  output.push('/// @title GeneratedMerkleData');
  output.push('/// @notice Merkle roots and proofs for test data');
  output.push('library GeneratedMerkleData {');
  output.push('');

  for (const tc of testCases) {
    const leaves = enumerateLeaves(tc.tree);
    const root = computeRoot(leaves);

    output.push(`    // ${tc.comment} - Merkle root`);
    output.push(`    function get${tc.name}MerkleRoot() internal pure returns (bytes32) {`);
    output.push(`        return ${root};`);
    output.push(`    }`);
    output.push('');

    // Generate proofs for accessed fields
    if (tc.accessedFields) {
      for (const field of tc.accessedFields) {
        try {
          const proofData = generateProof(leaves, field.path);
          const pathCBORHex = bytesToHex(proofData.pathCBOR);
          const valueBytesHex = bytesToHex(proofData.valueBytes);

          output.push(`    // ${tc.name}: ${field.description} (path: [${field.path.join(', ')}])`);
          output.push(`    function get${tc.name}Proof_${field.description}() internal pure returns (`);
          output.push(`        bytes memory pathCBOR,`);
          output.push(`        bytes memory valueBytes,`);
          output.push(`        bytes32[] memory proof,`);
          output.push(`        bool[] memory directions`);
          output.push(`    ) {`);
          output.push(`        pathCBOR = hex"${pathCBORHex.slice(2)}";`);
          output.push(`        valueBytes = hex"${valueBytesHex.slice(2)}";`);
          output.push(`        proof = new bytes32[](${proofData.proof.length});`);

          proofData.proof.forEach((p, i) => {
            output.push(`        proof[${i}] = ${p};`);
          });

          output.push(`        directions = new bool[](${proofData.directions.length});`);
          proofData.directions.forEach((d, i) => {
            output.push(`        directions[${i}] = ${d};`);
          });

          output.push(`    }`);
          output.push('');
        } catch (error) {
          console.error(`Error generating proof for ${tc.name} field ${field.description}:`, error);
        }
      }
    }
  }

  output.push('}');
  output.push('');
  output.push('/*');
  output.push('MERKLE DATA GENERATION:');
  output.push('=======================');
  output.push('');
  output.push('All Merkle roots and proofs have been generated from the TypeScript implementation.');
  output.push('To regenerate: npm run generate-test-data');
  output.push('');
  output.push('For each test case:');
  output.push('1. Merkle root: keccak256 root of all descriptor leaves');
  output.push('2. Proofs: Merkle proofs for commonly accessed fields');
  output.push('3. Directions: true if current node is right child, false if left child');
  output.push('');
  output.push('Leaf computation: keccak256(pathCBOR || "=" || valueBytes)');
  output.push('Parent computation: keccak256(left || right)');
  output.push('*/');

  return output.join('\n');
}

// ============================================================================
// Main Execution
// ============================================================================

if (mode === 'merkle') {
  console.log(generateMerkle());
}
