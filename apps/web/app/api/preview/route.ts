import { NextRequest, NextResponse } from 'next/server';
import {
  buildCanonicalTree,
  enumerateLeaves,
  computeRoot,
  buildMerkleTreeStructure,
  type DescriptorTree,
  type GroupNode
} from '@fixdescriptorkit/ts-sdk';
export const runtime = 'nodejs';

type TreeNodeData = {
  tag?: string;
  name?: string;
  value?: string;
  type: 'scalar' | 'group' | 'entry' | 'root';
  children?: TreeNodeData[];
  path?: number[];
  isExpanded?: boolean;
};

// Convert DescriptorTree to TreeNodeData format
function descriptorTreeToTreeData(tree: DescriptorTree, schemaFieldMapping: Record<string, { name: string; type: string }> = {}): TreeNodeData {
  const root: TreeNodeData = {
    type: 'root',
    name: 'FIX Descriptor',
    children: [],
    isExpanded: true
  };

  const children: TreeNodeData[] = [];

  for (const [tagNum, value] of Object.entries(tree)) {
    const tag = String(tagNum);
    const schemaField = schemaFieldMapping[tag];
    const fieldName = schemaField?.name;

    if (typeof value === 'string') {
      // Scalar field
      children.push({
        type: 'scalar',
        tag,
        name: fieldName,
        value,
        path: [Number(tag)],
        isExpanded: false
      });
    } else {
      // Group
      const groupNode = value as GroupNode;
      const groupChildren: TreeNodeData[] = [];

      groupNode.entries.forEach((entry, index) => {
        const entryChildren: TreeNodeData[] = [];
        
        for (const [entryTagNum, entryValue] of Object.entries(entry)) {
          const entryTag = String(entryTagNum);
          const schemaEntryField = schemaFieldMapping[entryTag];
          const entryFieldName = schemaEntryField?.name;

          if (typeof entryValue === 'string') {
            entryChildren.push({
              type: 'scalar',
              tag: entryTag,
              name: entryFieldName,
              value: entryValue as string,
              path: [Number(tag), index + 1, Number(entryTag)],
              isExpanded: false
            });
            continue;
          }

          const nestedGroup = entryValue as GroupNode;
          const nestedChildren: TreeNodeData[] = [];
          nestedGroup.entries.forEach((nestedEntry, nestedIndex) => {
            const nestedEntryChildren: TreeNodeData[] = [];
            for (const [nestedTagNum, nestedValue] of Object.entries(nestedEntry)) {
              const nestedTag = String(nestedTagNum);
              const nestedSchemaField = schemaFieldMapping[nestedTag];
              const nestedFieldName = nestedSchemaField?.name;
              nestedEntryChildren.push({
                type: 'scalar',
                tag: nestedTag,
                name: nestedFieldName,
                value: String(nestedValue),
                path: [Number(tag), index + 1, Number(entryTag), nestedIndex + 1, Number(nestedTag)],
                isExpanded: false
              });
            }
            nestedChildren.push({
              type: 'entry',
              name: `Entry ${nestedIndex + 1}`,
              children: nestedEntryChildren,
              path: [Number(tag), index + 1, Number(entryTag), nestedIndex + 1],
              isExpanded: false
            });
          });

          entryChildren.push({
            type: 'group',
            tag: entryTag,
            name: entryFieldName,
            value: String(nestedGroup.entries.length),
            children: nestedChildren,
            path: [Number(tag), index + 1, Number(entryTag)],
            isExpanded: false
          });
        }

        groupChildren.push({
          type: 'entry',
          name: `Entry ${index + 1}`,
          children: entryChildren,
          path: [Number(tag), index + 1],
          isExpanded: false
        });
      });

      children.push({
        type: 'group',
        tag,
        name: fieldName,
        value: String(groupNode.entries.length),
        children: groupChildren,
        path: [Number(tag)],
        isExpanded: false
      });
    }
  }

  root.children = children;
  return root;
}

type ParsedFieldNode = {
  tag?: string;
  name?: string;
  value?: string;
  type: 'scalar' | 'group' | 'entry';
  children?: ParsedFieldNode[];
};

function treeToParsedFields(tree: DescriptorTree, schemaFieldMapping: Record<string, { name: string; type: string }> = {}): ParsedFieldNode[] {
  const fields: ParsedFieldNode[] = [];

  for (const [tagNum, value] of Object.entries(tree)) {
    const tag = String(tagNum);
    const schemaField = schemaFieldMapping[tag];
    const fieldName = schemaField?.name;

    if (typeof value === 'string') {
      fields.push({ type: 'scalar', tag, name: fieldName, value });
      continue;
    }

    const groupNode = value as GroupNode;
    const groupEntries: ParsedFieldNode[] = groupNode.entries.map((entry, index) => {
      const entryChildren: ParsedFieldNode[] = [];
      for (const [entryTagNum, entryValue] of Object.entries(entry)) {
        const entryTag = String(entryTagNum);
        const entrySchemaField = schemaFieldMapping[entryTag];
        const entryFieldName = entrySchemaField?.name;
        if (typeof entryValue === 'string') {
          entryChildren.push({ type: 'scalar', tag: entryTag, name: entryFieldName, value: entryValue as string });
          continue;
        }
        const nestedGroup = entryValue as GroupNode;
        const nestedEntries: ParsedFieldNode[] = nestedGroup.entries.map((nestedEntry, nestedIndex) => {
          const nestedEntryChildren: ParsedFieldNode[] = [];
          for (const [nestedTagNum, nestedValue] of Object.entries(nestedEntry)) {
            const nestedTag = String(nestedTagNum);
            const nestedSchemaField = schemaFieldMapping[nestedTag];
            const nestedFieldName = nestedSchemaField?.name;
            nestedEntryChildren.push({ type: 'scalar', tag: nestedTag, name: nestedFieldName, value: String(nestedValue) });
          }
          return { type: 'entry', name: `Entry ${nestedIndex + 1}`, children: nestedEntryChildren };
        });
        entryChildren.push({ type: 'group', tag: entryTag, name: entryFieldName, value: String(nestedGroup.entries.length), children: nestedEntries });
      }
      return { type: 'entry', name: `Entry ${index + 1}`, children: entryChildren };
    });

    fields.push({ type: 'group', tag, name: fieldName, value: String(groupNode.entries.length), children: groupEntries });
  }

  return fields;
}

// Build DescriptorTree from SBE parsed fields (group-aware)
function buildTreeFromSbeFields(parsedFields: Record<string, unknown>): DescriptorTree {
  const tree: DescriptorTree = {};
  
  for (const [tag, value] of Object.entries(parsedFields)) {
    if (Array.isArray(value)) {
      const entries = value.map((entry) => buildGroupEntry(entry as Record<string, unknown>));
      tree[Number(tag)] = { tag: Number(tag), entries };
      continue;
    }
    tree[Number(tag)] = String(value);
  }
  
  return tree;
}

function buildGroupEntry(entry: Record<string, unknown>): Record<number, string | GroupNode> {
  const result: Record<number, string | GroupNode> = {};
  for (const [tag, value] of Object.entries(entry)) {
    if (Array.isArray(value)) {
      const entries = value.map((nestedEntry) => buildGroupEntry(nestedEntry as Record<string, unknown>));
      result[Number(tag)] = { tag: Number(tag), entries };
      continue;
    }
    result[Number(tag)] = String(value);
  }
  return result;
}

// Parse SBE schema to extract field ID to name mapping
function parseSchemaFieldMapping(schemaXml: string): Record<string, { name: string; type: string }> {
  const mapping: Record<string, { name: string; type: string }> = {};
  
  try {
    // Simple regex-based parsing to extract field/data elements
    // Match both <field> and <data> elements
    const fieldRegex = /<(?:sbe:)?(?:field|data)\s+(?:[^>]*?\s+)?name=["']([^"']+)["'](?:[^>]*?\s+)?id=["'](\d+)["'](?:[^>]*?\s+)?type=["']([^"']+)["']/g;
    const fieldRegex2 = /<(?:sbe:)?(?:field|data)\s+(?:[^>]*?\s+)?id=["'](\d+)["'](?:[^>]*?\s+)?name=["']([^"']+)["'](?:[^>]*?\s+)?type=["']([^"']+)["']/g;
    
    let match;
    while ((match = fieldRegex.exec(schemaXml)) !== null) {
      const [, name, id, type] = match;
      mapping[id] = { name, type };
    }
    
    // Reset and try alternate attribute order
    while ((match = fieldRegex2.exec(schemaXml)) !== null) {
      const [, id, name, type] = match;
      mapping[id] = { name, type };
    }
  } catch (e) {
    console.error('Error parsing schema:', e);
  }
  
  return mapping;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const { fixRaw, schema, messageId } = await req.json();
    console.log('[preview] request', {
      fixLength: typeof fixRaw === 'string' ? fixRaw.length : null,
      schemaLength: typeof schema === 'string' ? schema.length : null,
      messageId
    });
    
    // Get SBE encoder endpoint from environment
    const encoderBaseUrl = process.env.ENCODER_URL;
    
    if (!encoderBaseUrl) {
      throw new Error('ENCODER_URL environment variable is not configured');
    }
    const encoderBase = encoderBaseUrl.replace(/\/$/, '');
    const encodeUrl = `${encoderBase}/encode`;
    const decodeUrl = `${encoderBase}/decode`;
    
    // Call encoder service to encode the FIX message
    const encodeStarted = Date.now();
    const encodeResponse = await fetch(encodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        fixMessage: fixRaw,
        messageId: messageId || undefined
      })
    });
    console.log('[preview] encode response', {
      status: encodeResponse.status,
      durationMs: Date.now() - encodeStarted
    });
    
    if (!encodeResponse.ok) {
      const errorText = await encodeResponse.text();
      throw new Error(`SBE encoding failed: ${errorText}`);
    }
    
    const encodeResult = await encodeResponse.json();
    console.log('[preview] encode result', {
      encodedBytes: encodeResult?.encodedBytes,
      encodedHexLength: encodeResult?.encodedHex?.length
    });
    const encodedHex = encodeResult.encodedHex;
    if (!encodedHex) {
      throw new Error('SBE encoding failed: missing encodedHex');
    }
    const encodedHexClean = encodedHex.startsWith('0x') ? encodedHex.slice(2) : encodedHex;
    const sbeHex = encodedHex.startsWith('0x') ? encodedHex : `0x${encodedHex}`;
    const sbeBase64 = Buffer.from(encodedHexClean, 'hex').toString('base64');

    // Decode to get parsed fields for preview tree
    const decodeStarted = Date.now();
    console.log('[preview] decode request', { url: decodeUrl });
    const decodeResponse = await fetch(decodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        encodedMessage: encodedHex,
        messageId: messageId || undefined
      })
    });
    console.log('[preview] decode response', {
      status: decodeResponse.status,
      durationMs: Date.now() - decodeStarted
    });
    if (!decodeResponse.ok) {
      const errorText = await decodeResponse.text();
      throw new Error(`SBE decoding failed: ${errorText}`);
    }
    console.log('[preview] decode json start');
    const decodeResult = await decodeResponse.json();
    console.log('[preview] decode json done');
    console.log('[preview] decode result', {
      decodedFields: Object.keys(decodeResult?.decodedFields || {}).length,
      fixMessageLength: decodeResult?.fixMessage?.length
    });

    // Build tree from decoded fields
    const tree = buildTreeFromSbeFields(decodeResult.decodedFields || {});
    const canonical = buildCanonicalTree(tree);
    
    const leaves = enumerateLeaves(canonical);
    
    // Build complete Merkle tree structure with all real keccak256 hashes
    const merkleTree = buildMerkleTreeStructure(leaves);
    
    const paths: number[][] = leaves.map((l) => l.path);
    const root = computeRoot(leaves);
    
    // Parse schema to get field metadata
    const schemaFieldMapping = parseSchemaFieldMapping(schema);
    
    // Convert parsed tree to UI-friendly formats with schema field names
    const treeData = descriptorTreeToTreeData(tree, schemaFieldMapping);
    
    const mappedFieldsFromSbe = {};
    const parsedFields = treeToParsedFields(tree, schemaFieldMapping);
    
    const response = { 
      root, 
      sbeHex, // For deployment (contracts need hex)
      sbeBase64, // For display
      leavesCount: leaves.length, 
      paths,
      merkleTree, // Complete tree structure with all real hashes
      treeData, // Structured tree data for tree view
      parsedFields, // Fields from SBE encoder with schema metadata
      sbeMetadata: {
        mappedFields: mappedFieldsFromSbe,
        encodedBytes: encodeResult.encodedBytes,
        schemaFields: schemaFieldMapping
      }
    };
    console.log('[preview] success', { durationMs: Date.now() - started });
    return NextResponse.json(response);
  } catch (e: unknown) {
    console.error('[preview] error', e);
    const msg = e instanceof Error
      ? e.message
      : (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message?: unknown }).message === 'string'
         ? (e as { message: string }).message
         : 'Preview failed');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
