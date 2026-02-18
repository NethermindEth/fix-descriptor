export type {
  Tag,
  Path,
  FixValue,
  ScalarNode,
  GroupEntry,
  GroupNode,
  DescriptorTree,
  CanonicalResult,
  GroupSchema,
  FixSchema,
  EncodeAllOptions,
} from './types.js';

export { DEMO_FIX_SCHEMA } from './types.js';

export { parseFixDescriptor, treeToFixMessage } from './parse.js';
export { buildCanonicalTree } from './canonical.js';
export {
  enumerateLeaves,
  computeRoot,
  generateProof,
  verifyProofLocal,
  buildMerkleTreeStructure,
  type MerkleTreeNode,
} from './merkle.js';


export {
  orchestraToSbe,
  orchestraToSbeFullSchema,
  hashOrchestraFile,
  extractMessageIdFromSbe,
  type OrchestraField,
} from './orchestraToSbe.js';

// SBE encode/decode functions are available via subpath exports:
//   import { encodeFromInput } from 'fixdescriptorkit-typescript/sbe/encode'
//   import { decodeFromInput } from 'fixdescriptorkit-typescript/sbe/decode'
// They are NOT re-exported from the main entry to avoid bundler issues
// with their dynamic imports and child_process usage.
export type { EncodeArgs } from './sbe/lib.js';
export type { DecodeArgs } from './sbe/lib.js';
export type { GeneratorResult } from './sbe/lib.js';

import { parseFixDescriptor } from './parse.js';
import { buildCanonicalTree } from './canonical.js';
import { enumerateLeaves, computeRoot } from './merkle.js';
import type { CanonicalResult, EncodeAllOptions } from './types.js';
import { keccak256, hexToBytes, bytesToHex } from 'viem';

// Merkle delimiter: "=" (UTF-8 byte 0x3d)
const MERKLE_DELIMITER = new Uint8Array([0x3d]);

export function encodeAll(rawFix: string, opts?: EncodeAllOptions): CanonicalResult {
  const tree = parseFixDescriptor(rawFix, { allowSOH: true, schema: opts?.schema });
  const canonical = buildCanonicalTree(tree);
  const leavesFull = enumerateLeaves(canonical);
  const root = computeRoot(leavesFull);
  const outLeaves = leavesFull.map(({ pathCBOR, valueBytes }) => {
    const bytes = new Uint8Array(pathCBOR.length + MERKLE_DELIMITER.length + valueBytes.length);
    bytes.set(pathCBOR, 0);
    bytes.set(MERKLE_DELIMITER, pathCBOR.length);
    bytes.set(valueBytes, pathCBOR.length + MERKLE_DELIMITER.length);
    const leaf = bytesToHex(hexToBytes(keccak256(bytes)));
    return { pathCBOR, valueBytes, leaf: leaf as `0x${string}` };
  });
  return { tree: canonical, leaves: outLeaves, root };
}
