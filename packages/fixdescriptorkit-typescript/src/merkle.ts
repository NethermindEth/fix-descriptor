import { keccak256, toBytes, concat, hexToBytes, bytesToHex } from 'viem';
import { Encoder } from 'cbor-x';
import type { DescriptorTree, GroupNode, Path, Tag } from './types';

const pathEncoder = new Encoder();

// Merkle delimiter: "=" (UTF-8 byte 0x3d)
const MERKLE_DELIMITER = new Uint8Array([0x3d]);

function encodePathCBOR(path: Path): Uint8Array {
  // encode as canonical CBOR array of unsigned integers
  return pathEncoder.encode(path);
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function enumerateLeaves(tree: DescriptorTree): Array<{ path: Path; pathCBOR: Uint8Array; valueBytes: Uint8Array }> {
  const leaves: Array<{ path: Path; pathCBOR: Uint8Array; valueBytes: Uint8Array }> = [];

  function isGroupNodeLike(value: unknown): value is GroupNode {
    return !!value && typeof value === 'object' && 'entries' in (value as Record<string, unknown>) && Array.isArray((value as GroupNode).entries);
  }

  function addLeaf(path: Path, value: string) {
    const pathCBOR = encodePathCBOR(path);
    leaves.push({ path, pathCBOR, valueBytes: utf8Bytes(value) });
  }

  function processMap(map: Record<Tag, any>, path: Path) {
    for (const [key, raw] of Object.entries(map)) {
      const tag = Number(key) as Tag;
      if (typeof raw === 'string') {
        addLeaf([...path, tag], raw);
        continue;
      }

      if (isGroupNodeLike(raw)) {
        processGroup(raw, [...path, tag]);
      }
    }
  }

  function processGroup(group: GroupNode, pathToGroup: Path) {
    group.entries.forEach((entry, idx) => {
      const entryPath = [...pathToGroup, idx];
      for (const [key, raw] of Object.entries(entry)) {
        const fieldTag = Number(key) as Tag;
        if (typeof raw === 'string') {
          addLeaf([...entryPath, fieldTag], raw);
          continue;
        }

        if (isGroupNodeLike(raw)) {
          const nestedTag = raw.tag ?? fieldTag;
          processGroup(raw, [...entryPath, nestedTag]);
        }
      }
    });
  }

  processMap(tree, []);

  // Sort by pathCBOR lexicographically (byte order)
  leaves.sort((a, b) => {
    const A = a.pathCBOR;
    const B = b.pathCBOR;
    const len = Math.min(A.length, B.length);
    for (let i = 0; i < len; i++) {
      if (A[i] !== B[i]) return A[i] - B[i];
    }
    return A.length - B.length;
  });

  return leaves;
}

export function computeRoot(leaves: Array<{ pathCBOR: Uint8Array; valueBytes: Uint8Array }>): `0x${string}` {
  if (leaves.length === 0) {
    // Empty tree - return hash of empty string per SPEC
    return keccak256(new Uint8Array(0)) as `0x${string}`;
  }
  
  const leafHashes: Uint8Array[] = leaves.map(({ pathCBOR, valueBytes }) => {
    const bytes = new Uint8Array(pathCBOR.length + MERKLE_DELIMITER.length + valueBytes.length);
    bytes.set(pathCBOR, 0);
    bytes.set(MERKLE_DELIMITER, pathCBOR.length);
    bytes.set(valueBytes, pathCBOR.length + MERKLE_DELIMITER.length);
    const h = keccak256(bytes);
    return hexToBytes(h);
  });

  let level = leafHashes;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        // Promote odd node (SPEC requirement)
        next.push(level[i]);
      } else {
        const left = level[i];
        const right = level[i + 1];
        const combined = new Uint8Array(left.length + right.length);
        combined.set(left, 0);
        combined.set(right, left.length);
        next.push(hexToBytes(keccak256(combined)));
      }
    }
    level = next;
  }
  return bytesToHex(level[0]) as `0x${string}`;
}

export function generateProof(
  leaves: Array<{ path: Path; pathCBOR: Uint8Array; valueBytes: Uint8Array }>,
  targetPath: Path
): { pathCBOR: Uint8Array; valueBytes: Uint8Array; proof: `0x${string}`[]; directions: boolean[] } {
  if (leaves.length === 0) throw new Error('No leaves available for proof generation');
  
  // Find exact path match
  const index = leaves.findIndex((leaf) => {
    if (leaf.path.length !== targetPath.length) return false;
    return leaf.path.every((value, i) => value === targetPath[i]);
  });
  
  if (index === -1) {
    throw new Error(`Target path ${JSON.stringify(targetPath)} not found in leaves`);
  }

  const hashes: Uint8Array[] = leaves.map(({ pathCBOR, valueBytes }) => {
    const bytes = new Uint8Array(pathCBOR.length + MERKLE_DELIMITER.length + valueBytes.length);
    bytes.set(pathCBOR, 0);
    bytes.set(MERKLE_DELIMITER, pathCBOR.length);
    bytes.set(valueBytes, pathCBOR.length + MERKLE_DELIMITER.length);
    return hexToBytes(keccak256(bytes));
  });

  let idx = index;
  const proof: `0x${string}`[] = [];
  const directions: boolean[] = [];

  let level = hashes;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const siblingIndex = isRight ? idx - 1 : idx + 1;
    
    if (siblingIndex < level.length) {
      proof.push(bytesToHex(level[siblingIndex]) as `0x${string}`);
      directions.push(isRight); // true if current node is right child
    }
    // If no sibling (odd promotion), skip adding to proof
    
    // Move up a level
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        next.push(level[i]); // promote odd node
      } else {
        const left = level[i];
        const right = level[i + 1];
        const combined = new Uint8Array(left.length + right.length);
        combined.set(left, 0);
        combined.set(right, left.length);
        next.push(hexToBytes(keccak256(combined)));
      }
    }
    idx = Math.floor(idx / 2);
    level = next;
  }

  const target = leaves[index];
  return { pathCBOR: target.pathCBOR, valueBytes: target.valueBytes, proof, directions };
}

export function verifyProofLocal(
  root: `0x${string}`,
  pathCBOR: Uint8Array,
  valueBytes: Uint8Array,
  proof: `0x${string}`[],
  directions: boolean[]
): boolean {
  const leafBytes = new Uint8Array(pathCBOR.length + MERKLE_DELIMITER.length + valueBytes.length);
  leafBytes.set(pathCBOR, 0);
  leafBytes.set(MERKLE_DELIMITER, pathCBOR.length);
  leafBytes.set(valueBytes, pathCBOR.length + MERKLE_DELIMITER.length);
  let node = hexToBytes(keccak256(leafBytes));
  for (let i = 0; i < proof.length; i++) {
    const sib = hexToBytes(proof[i]);
    const isRight = directions[i] === true;
    let combined: Uint8Array;
    if (isRight) {
      // current node is right child: parent = keccak(sib || node)
      combined = new Uint8Array(sib.length + node.length);
      combined.set(sib, 0);
      combined.set(node, sib.length);
    } else {
      // current node is left child: parent = keccak(node || sib)
      combined = new Uint8Array(node.length + sib.length);
      combined.set(node, 0);
      combined.set(sib, node.length);
    }
    node = hexToBytes(keccak256(combined));
  }
  return bytesToHex(node) === root;
}

// Merkle tree node structure for visualization
export interface MerkleTreeNode {
  hash: `0x${string}`;
  type: 'leaf' | 'parent' | 'root';
  path?: Path;
  left?: MerkleTreeNode;
  right?: MerkleTreeNode;
}

/**
 * Build complete Merkle tree structure with all intermediate hashes
 * @param leaves - Array of leaves with path and value data
 * @returns Root node of the complete Merkle tree with all hashes
 */
export function buildMerkleTreeStructure(
  leaves: Array<{ path: Path; pathCBOR: Uint8Array; valueBytes: Uint8Array }>
): MerkleTreeNode {
  if (leaves.length === 0) {
    // Empty tree
    return {
      hash: keccak256(new Uint8Array(0)) as `0x${string}`,
      type: 'root'
    };
  }

  // Create leaf nodes with their hashes
  const leafNodes: MerkleTreeNode[] = leaves.map(({ path, pathCBOR, valueBytes }) => {
    const bytes = new Uint8Array(pathCBOR.length + MERKLE_DELIMITER.length + valueBytes.length);
    bytes.set(pathCBOR, 0);
    bytes.set(MERKLE_DELIMITER, pathCBOR.length);
    bytes.set(valueBytes, pathCBOR.length + MERKLE_DELIMITER.length);
    return {
      hash: keccak256(bytes) as `0x${string}`,
      type: 'leaf',
      path
    };
  });

  // Build tree bottom-up, keeping structure
  function buildLevel(nodes: MerkleTreeNode[], isRoot: boolean): MerkleTreeNode[] {
    if (nodes.length === 1) {
      // Mark as root
      nodes[0].type = 'root';
      return nodes;
    }

    const parents: MerkleTreeNode[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 >= nodes.length) {
        // Promote odd node
        parents.push(nodes[i]);
      } else {
        const left = nodes[i];
        const right = nodes[i + 1];
        
        // Compute parent hash: keccak256(left || right)
        const leftBytes = hexToBytes(left.hash);
        const rightBytes = hexToBytes(right.hash);
        const combined = new Uint8Array(leftBytes.length + rightBytes.length);
        combined.set(leftBytes, 0);
        combined.set(rightBytes, leftBytes.length);
        
        parents.push({
          hash: keccak256(combined) as `0x${string}`,
          type: 'parent',
          left,
          right
        });
      }
    }
    
    return buildLevel(parents, parents.length === 1);
  }

  const tree = buildLevel(leafNodes, leafNodes.length === 1);
  return tree[0];
}

