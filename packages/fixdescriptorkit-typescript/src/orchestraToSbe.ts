/**
 * Convert FIX Orchestra XML to SBE Schema XML
 * 
 * Orchestra is the standard format for FIX specifications
 * This converts it to SBE format for use with the encoder
 */

import { keccak256 } from 'viem';

/**
 * Compute keccak256 hash of Orchestra XML bytes (UTF-8).
 * Use as schemaHash for FixDescriptor - ensures all parties use the same FIX dictionary.
 */
export function hashOrchestraFile(orchestraXml: string): `0x${string}` {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(orchestraXml);
  return keccak256(bytes);
}

export interface OrchestraField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

type FieldNode = {
  kind: 'field';
  id: string;
  name: string;
  type: string;
  required: boolean;
  semanticType?: string;
};

type GroupNode = {
  kind: 'group';
  id: string;
  name: string;
  required: boolean;
  children: SchemaNode[];
};

type SchemaNode = FieldNode | GroupNode;

/**
 * Generate a full SBE schema with ALL message types from Orchestra
 */
export function orchestraToSbeFullSchema(orchestraXml: string): string {
  try {
    // Parse Orchestra XML
    const parser = new DOMParser();
    const orchestraDoc = parser.parseFromString(orchestraXml, 'text/xml');
    
    // Check for parsing errors
    const parserError = findFirstByLocalName(orchestraDoc, 'parsererror');
    if (parserError) {
      throw new Error('Invalid XML: ' + parserError.textContent);
    }

    // Build field dictionary
    const fieldDictionary = buildFieldDictionary(orchestraDoc);
    
    // Extract components and groups
    const { components, groups } = extractComponentsAndGroups(orchestraDoc);
    
    // Find all message definitions
    const allMessages = orchestraDoc.getElementsByTagName('*');
    const messageElements: Array<{ element: Element; name: string; id: string }> = [];
    
    for (let i = 0; i < allMessages.length; i++) {
      const el = allMessages[i];
      const localName = el.localName || el.tagName.split(':').pop();
      if (localName === 'message') {
        const name = el.getAttribute('name');
        const id = el.getAttribute('id');
        if (name && id) {
          messageElements.push({ element: el, name, id });
        }
      }
    }
    
    console.log(`Found ${messageElements.length} messages in Orchestra XML`);
    
    if (messageElements.length === 0) {
      throw new Error('No message definitions found in Orchestra XML');
    }
    
    // Process each message
    const messages: Array<{ name: string; id: string; nodes: SchemaNode[] }> = [];
    
    for (const { element, name, id } of messageElements) {
      const nodes = extractNodesFromMessage(element, components, groups, fieldDictionary);
      
      if (nodes.length > 0) {
        messages.push({ name, id, nodes });
      }
    }
    
    // Generate full SBE schema with all messages
    return generateFullSbeSchema(messages);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Orchestra to SBE full schema conversion failed: ${error.message}`);
    }
    throw new Error('Orchestra to SBE full schema conversion failed');
  }
}

/**
 * Convert single message type from Orchestra to SBE
 */
export function orchestraToSbe(orchestraXml: string, messageType?: string): string {
  try {
    // Parse Orchestra XML
    const parser = new DOMParser();
    const orchestraDoc = parser.parseFromString(orchestraXml, 'text/xml');
    
    // Check for parsing errors
    const parserError = findFirstByLocalName(orchestraDoc, 'parsererror');
    if (parserError) {
      throw new Error('Invalid XML: ' + parserError.textContent);
    }

    // Build field dictionary
    const fieldDictionary = buildFieldDictionary(orchestraDoc);
    
    // Extract components and groups
    const { components, groups } = extractComponentsAndGroups(orchestraDoc);

    // Find the specified message definition in Orchestra
    if (!messageType) {
      throw new Error('Message type is required');
    }
    
    // Find message by name
    let messageElement: Element | null = null;
    const messages = orchestraDoc.getElementsByTagName('*');
    for (let i = 0; i < messages.length; i++) {
      const el = messages[i];
      const localName = el.localName || el.tagName.split(':').pop();
      if (localName === 'message' && el.getAttribute('name') === messageType) {
        messageElement = el;
        break;
      }
    }
    
    if (!messageElement) {
      throw new Error(`Message type "${messageType}" not found in Orchestra XML`);
    }
    
    // Get the actual message name and ID from Orchestra
    const messageName = messageElement.getAttribute('name') || messageType;
    const messageId = messageElement.getAttribute('id') || '1';
    
    console.log(`Found message definition for ${messageType} (name: ${messageName}, id: ${messageId})`);
    
    // Extract field IDs from message structure
    const nodes = extractNodesFromMessage(messageElement, components, groups, fieldDictionary);
    
    console.log(`Extracted ${nodes.length} nodes from ${messageType} message definition`);
    
    if (nodes.length === 0) {
      throw new Error('No valid fields found in Orchestra file');
    }

    // Generate SBE schema with the actual message name and ID from Orchestra
    return generateSbeSchema(messageName, messageId, nodes);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Orchestra to SBE conversion failed: ${error.message}`);
    }
    throw new Error('Orchestra to SBE conversion failed');
  }
}

/**
 * Build field dictionary from Orchestra XML
 */
function buildFieldDictionary(orchestraDoc: Document): Map<string, { name: string; type: string }> {
  const fieldDictionary = new Map<string, { name: string; type: string }>();
  
  // Find the <fields> container element first
  // Try multiple approaches to handle different namespace styles
  let fieldsContainer: Element | null = null;
  
  // Method 1: Try without namespace prefix
  let fieldsContainerList = orchestraDoc.getElementsByTagName('fields');
  
  // Method 2: Try with namespace URI
  if (fieldsContainerList.length === 0) {
    fieldsContainerList = orchestraDoc.getElementsByTagNameNS('http://fixprotocol.io/2016/fixrepository', 'fields');
  }
  
  // Method 3: Try to find any element with local name 'fields'
  if (fieldsContainerList.length === 0) {
    const allElements = orchestraDoc.getElementsByTagName('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.localName === 'fields' || el.tagName.endsWith(':fields')) {
        fieldsContainer = el;
        break;
      }
    }
  } else {
    fieldsContainer = fieldsContainerList[0];
  }
  
  if (fieldsContainer) {
    const children = getChildElements(fieldsContainer);
    console.log(`Found fields container with ${children.length} children`);
    
    // Only get field elements that are direct children of the fields container
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const localName = child.localName || child.tagName.split(':').pop();
      
      if (localName === 'field') {
        const id = child.getAttribute('id');
        const name = child.getAttribute('name');
        let type = child.getAttribute('type');
        
        // Some fields might have the type in a different attribute or not have a type
        // Default to String for fields without a type
        if (!type) {
          type = 'String';
        }
        
        if (id && name) {
          fieldDictionary.set(id, { name, type });
        }
      }
    }
  } else {
    console.warn('Could not find fields container in Orchestra XML');
  }
  
  return fieldDictionary;
}

/**
 * Extract components and groups from Orchestra XML
 */
function extractComponentsAndGroups(orchestraDoc: Document): { 
  components: Element[]; 
  groups: Element[] 
} {
  // Extract component information (handle both namespace-aware and non-namespace queries)
  let componentsCollection = orchestraDoc.getElementsByTagName('component');
  if (componentsCollection.length === 0) {
    componentsCollection = orchestraDoc.getElementsByTagNameNS('http://fixprotocol.io/2016/fixrepository', 'component');
  }
  
  // Convert to array for easier searching
  const components: Element[] = [];
  for (let i = 0; i < componentsCollection.length; i++) {
    components.push(componentsCollection[i]);
  }
  
  // Also check for fixr:component
  const fixrComponents = orchestraDoc.getElementsByTagName('*');
  for (let i = 0; i < fixrComponents.length; i++) {
    const el = fixrComponents[i];
    const localName = el.localName || el.tagName.split(':').pop();
    if (localName === 'component' && !components.includes(el)) {
      components.push(el);
    }
  }
  
  console.log(`Found ${components.length} components in Orchestra XML`);
  
  // Get groups for resolving group references
  const allGroups = orchestraDoc.getElementsByTagName('*');
  const groups: Element[] = [];
  for (let i = 0; i < allGroups.length; i++) {
    const el = allGroups[i];
    const localName = el.localName || el.tagName.split(':').pop();
    if (localName === 'group') {
      groups.push(el);
    }
  }
  
  return { components, groups };
}

/**
 * Extract message nodes (fields + groups) from message structure with presence information
 */
function extractNodesFromMessage(
  messageElement: Element,
  components: Element[],
  groups: Element[],
  fieldDictionary: Map<string, { name: string; type: string }>
): SchemaNode[] {
  const structure = findFirstByLocalName(messageElement, 'structure');
  if (!structure) {
    return [];
  }

  const extractNodes = (element: Element, inheritedPresence: string = 'optional'): SchemaNode[] => {
    const nodes: SchemaNode[] = [];

    const children = getChildElements(element);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const localName = (child.localName || child.tagName.split(':').pop() || '').toLowerCase();

      if (localName === 'numingroup') {
        continue;
      }

      if (localName === 'fieldref') {
        const fieldId = child.getAttribute('id');
        if (!fieldId || !fieldDictionary.has(fieldId)) {
          continue;
        }
        const fieldPresence = child.getAttribute('presence') || inheritedPresence;
        const isRequired = fieldPresence === 'required';
      const fieldDef = fieldDictionary.get(fieldId)!;
        const mappedType = mapOrchestraTypeToSbe(fieldDef.type);
        const sanitizedName = sanitizeFieldName(fieldDef.name);
      const semanticType = mapOrchestraSemanticType(fieldDef.type);

        nodes.push({
          kind: 'field',
          id: fieldId,
          name: sanitizedName,
          type: mappedType,
          required: isRequired,
        semanticType
        });
        continue;
      }

      if (localName === 'componentref') {
        const compId = child.getAttribute('id');
        if (!compId) {
          continue;
        }
        const comp = components.find(c => c.getAttribute('id') === compId);
        if (comp) {
          const compPresence = child.getAttribute('presence') || 'optional';
          nodes.push(...extractNodes(comp, compPresence));
        }
        continue;
      }

      if (localName === 'groupref') {
        const groupId = child.getAttribute('id');
        if (!groupId) {
          continue;
        }
        const group = groups.find(g => g.getAttribute('id') === groupId);
        if (!group) {
          continue;
        }
        const groupPresence = child.getAttribute('presence') || 'optional';
        const groupName = group.getAttribute('name') || `Group${groupId}`;
        const numInGroup = findNumInGroupId(group);
        const groupChildren = extractNodes(group, groupPresence);
        nodes.push({
          kind: 'group',
          id: numInGroup ?? groupId,
          name: groupName,
          required: groupPresence === 'required',
          children: groupChildren,
        });
        continue;
      }
    }

    return nodes;
  };

  return extractNodes(structure, 'optional');
}

/**
 * Map Orchestra field types to SBE types.
 * Covers FIX 4.4 data types per spec:
 * - Primitives: char, Boolean, float, int, String, data
 * - int-derived: DayOfMonth, Length, NumInGroup, SeqNum, TagNum
 * - float-derived: Amt, Price, PriceOffset, Qty, Percentage
 * - String-derived: Currency, Exchange, Country, LocalMktDate, MonthYear,
 *   MultipleValueString, MultipleCharValue, UTCTimeOnly, UTCTimestamp, UTCDateOnly
 * - CodeSets (enums): handled via includes('CodeSet') -> varStringEncoding
 */
function mapOrchestraTypeToSbe(orchestraType: string): string {
  const typeMap: Record<string, string> = {
    // String types (FIX 4.4 primitives + derived)
    'String': 'varStringEncoding',
    'MultipleStringValue': 'varStringEncoding',
    'MultipleCharValue': 'varStringEncoding',
    'MultipleValueString': 'varStringEncoding',
    'char': 'char',

    // Integer types (FIX 4.4 int-derived)
    'int': 'int64',
    'Int': 'int64',
    'Length': 'uint32',
    'SeqNum': 'uint32',
    'NumInGroup': 'uint16',
    'TagNum': 'uint16',
    'DayOfMonth': 'uint32',

    // Numeric types (FIX 4.4 float-derived)
    'Qty': 'int64',
    'Price': 'int64',
    'PriceOffset': 'int64',
    'Amt': 'int64',
    'float': 'float',
    'double': 'double',
    'Percentage': 'float',

    // Date/Time types (FIX 4.4 String-derived)
    'UTCTimestamp': 'uint64',
    'UTCTimeOnly': 'uint64',
    'UTCDateOnly': 'uint32',
    'LocalMktDate': 'uint32',
    'MonthYear': 'uint32',
    'TZTimeOnly': 'uint64',
    'TZTimestamp': 'uint64',

    // Boolean (FIX 4.4 char-derived)
    'Boolean': 'uint8',

    // Raw data (FIX 4.4)
    'data': 'varDataEncoding',
    'XMLData': 'varDataEncoding',

    // FIX 4.4 String-derived semantic types
    'Currency': 'varStringEncoding',
    'Exchange': 'varStringEncoding',
    'Country': 'varStringEncoding',
  };

  // CodeSets (enums) - all *CodeSet types map to variable-length strings
  if (orchestraType.includes('CodeSet')) {
    return 'varStringEncoding';
  }

  // Variable-length string types (catch-all for String-derived)
  if (orchestraType.toLowerCase().includes('string')) {
    return 'varStringEncoding';
  }

  return typeMap[orchestraType] || 'varStringEncoding';
}

/**
 * Get appropriate null value for SBE type (for optional fields)
 */
function getNullValue(sbeType: string): string {
  // According to SBE spec, null values are typically:
  // - Unsigned integers: max value for the type
  // - Signed integers: min value for the type  
  // - Float/Double: NaN
  // - Char: 0 (null character)
  const nullValues: Record<string, string> = {
    'uint8': '255',
    'uint16': '65535',
    'uint32': '4294967295',
    'uint64': '18446744073709551615',
    'int8': '-128',
    'int16': '-32768',
    'int32': '-2147483648',
    'int64': '-9223372036854775808',
    'float': 'NaN',
    'double': 'NaN',
    'char': '\\0',
  };
  
  return nullValues[sbeType] || '0';
}

/**
 * Generate complete SBE schema XML with all messages
 */
function generateFullSbeSchema(
  messages: Array<{ name: string; id: string; nodes: SchemaNode[] }>
): string {
  // Generate message definitions
  const messageDefinitions = messages.map(({ name, id, nodes }) => {
    const sbeFields = renderNodes(nodes, '    ');
    
    return `  <sbe:message name="${name}" id="${id}">
${sbeFields}
  </sbe:message>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema xmlns:sbe="http://fixprotocol.io/2016/sbe" 
                   package="com.example.sbe" 
                   id="1" 
                   version="0" 
                   byteOrder="littleEndian">
  <types>
    <composite name="messageHeader">
      <type name="blockLength" primitiveType="uint16"/>
      <type name="templateId" primitiveType="uint16"/>
      <type name="schemaId" primitiveType="uint16"/>
      <type name="version" primitiveType="uint16"/>
    </composite>
    <composite name="groupSizeEncoding">
      <type name="blockLength" primitiveType="uint16"/>
      <type name="numInGroup" primitiveType="uint16"/>
    </composite>
    <composite name="varStringEncoding">
      <type name="length" primitiveType="uint16"/>
      <type name="varData" primitiveType="uint8" length="0" characterEncoding="UTF-8"/>
    </composite>
    <composite name="varDataEncoding">
      <type name="length" primitiveType="uint16"/>
      <type name="varData" primitiveType="uint8" length="0"/>
    </composite>
  </types>
${messageDefinitions}
</sbe:messageSchema>`;
}

/**
 * Generate complete SBE schema XML
 */
function generateSbeSchema(
  messageName: string,
  messageId: string,
  nodes: SchemaNode[]
): string {
  const sbeFields = renderNodes(nodes, '    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema xmlns:sbe="http://fixprotocol.io/2016/sbe" 
                   package="com.example.sbe" 
                   id="1" 
                   version="0" 
                   byteOrder="littleEndian">
  <types>
    <composite name="messageHeader">
      <type name="blockLength" primitiveType="uint16"/>
      <type name="templateId" primitiveType="uint16"/>
      <type name="schemaId" primitiveType="uint16"/>
      <type name="version" primitiveType="uint16"/>
    </composite>
    <composite name="groupSizeEncoding">
      <type name="blockLength" primitiveType="uint16"/>
      <type name="numInGroup" primitiveType="uint16"/>
    </composite>
    <composite name="varStringEncoding">
      <type name="length" primitiveType="uint16"/>
      <type name="varData" primitiveType="uint8" length="0" characterEncoding="UTF-8"/>
    </composite>
    <composite name="varDataEncoding">
      <type name="length" primitiveType="uint16"/>
      <type name="varData" primitiveType="uint8" length="0"/>
    </composite>
  </types>
  <sbe:message name="${messageName}" id="${messageId}">
${sbeFields}
  </sbe:message>
</sbe:messageSchema>`;
}

function sanitizeFieldName(name: string): string {
  let sanitizedName = name;
  const lowerName = sanitizedName.toLowerCase();
  const javaKeywords = ['yield', 'class', 'interface', 'return', 'void', 'new', 'this', 'super'];
  if (javaKeywords.includes(lowerName)) {
    sanitizedName = sanitizedName + 'Value';
  }
  return sanitizedName;
}

function findNumInGroupId(groupElement: Element): string | null {
  const children = getChildElements(groupElement);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const localName = (child.localName || child.tagName.split(':').pop() || '').toLowerCase();
    if (localName === 'numingroup') {
      return child.getAttribute('id');
    }
  }
  return null;
}

function renderNodes(nodes: SchemaNode[], indent: string): string {
  const fieldParts: string[] = [];
  const groupParts: string[] = [];
  const dataParts: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'field') {
      const isVarLength = node.type === 'varStringEncoding' || node.type === 'varDataEncoding';
      const presenceAttr = (!node.required && !isVarLength) ? ' presence="optional"' : '';
      const nullValueAttr = (!node.required && !isVarLength) ? ` nullValue="${getNullValue(node.type)}"` : '';
      const semanticAttr = node.semanticType ? ` semanticType="${node.semanticType}"` : '';
      if (isVarLength) {
        dataParts.push(`${indent}<data name="${node.name}" id="${node.id}" type="${node.type}"/>`);
      } else {
        fieldParts.push(
          `${indent}<field name="${node.name}" id="${node.id}" type="${node.type}"${presenceAttr}${nullValueAttr}${semanticAttr}/>`,
        );
      }
      continue;
    }

    const groupChildren = renderNodes(node.children, `${indent}  `);
    const presenceAttr = node.required ? '' : ' presence="optional"';
    groupParts.push(
      `${indent}<group name="${node.name}" id="${node.id}" dimensionType="groupSizeEncoding"${presenceAttr}>\n${groupChildren}\n${indent}</group>`,
    );
  }

  return [...fieldParts, ...groupParts, ...dataParts].join('\n');
}

function mapOrchestraSemanticType(orchestraType: string): string | undefined {
  if (orchestraType === 'UTCTimestamp' || orchestraType === 'TZTimestamp') {
    return orchestraType;
  }
  return undefined;
}

/**
 * Extract message ID from SBE schema for a given message name
 */
export function extractMessageIdFromSbe(sbeSchema: string, messageName: string): string | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sbeSchema, 'text/xml');
    
    const parserError = findFirstByLocalName(doc, 'parsererror');
    if (parserError) {
      return null;
    }
    
    // Find message element by name
    const messages = doc.getElementsByTagName('*');
    for (let i = 0; i < messages.length; i++) {
      const el = messages[i];
      const localName = el.localName || el.tagName.split(':').pop();
      if (localName === 'message' && el.getAttribute('name') === messageName) {
        return el.getAttribute('id');
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to extract message ID:', error);
    return null;
  }
}

function findFirstByLocalName(root: Document | Element, target: string): Element | null {
  const elements = (root as Document).getElementsByTagName
    ? (root as Document).getElementsByTagName('*')
    : (root as Element).getElementsByTagName('*');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const localName = el.localName || el.tagName.split(':').pop();
    if (localName === target) {
      return el;
    }
  }
  return null;
}

function getChildElements(element: Element): Element[] {
  const children: Element[] = [];
  const nodes = element.childNodes || [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Element;
    if (node && node.nodeType === 1) {
      children.push(node);
    }
  }
  return children;
}
