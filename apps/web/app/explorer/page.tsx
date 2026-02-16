"use client";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Navigation from '@/components/Navigation';
import CollapsibleSection from '@/components/CollapsibleSection';
import MessageTypeSelector from '@/components/MessageTypeSelector';
import ParsedSchemaSection from '@/components/ParsedSchemaSection';
import MessageBuilderSection from '@/components/MessageBuilderSection';
import ExampleSelector from '@/components/ExampleSelector';
import LearnMore from '@/components/LearnMore';
import { abi as AssetTokenAbi } from '@/lib/abis/AssetTokenERC20';
import { chainFromEnv } from '@/lib/viemClient';
import { createPublicClient, http } from 'viem';
import { AddressLink, TransactionLink } from '@/components/BlockExplorerLink';
import { orchestraToSbe, orchestraToSbeFullSchema, extractMessageIdFromSbe } from '@fixdescriptorkit/ts-sdk/orchestraToSbe';
import { FaSyncAlt } from 'react-icons/fa';

// Extend Window interface for MetaMask
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isMetaMask?: boolean;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

type ProofResult = {
  pathCBORHex: string;
  valueHex: string;
  proof: string[];
  directions: boolean[];
} | null;

// Tree visualization types
type TreeNodeData = {
  tag?: string;
  name?: string;
  value?: string;
  type: 'scalar' | 'group' | 'entry' | 'root';
  children?: TreeNodeData[];
  path?: number[];
  isExpanded?: boolean;
};

type MerkleNodeData = {
  hash: string;
  type: 'leaf' | 'parent' | 'root';
  path?: number[];
  left?: MerkleNodeData;
  right?: MerkleNodeData;
  isHighlighted?: boolean;
  // For leaves: FIX tag and value information
  tag?: string;
  value?: string;
  name?: string;
};

// Example FIX messages for educational purposes
const EXAMPLES = {
  treasury: {
    name: "US Treasury Bond",
    description: "A simple government security with basic fields",
    fix: "8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|10=000"
  },
  corporate: {
    name: "Corporate Bond",
    description: "Corporate bond with nested groups and multiple identifiers",
    fix: "55=ACME-CORP-2028|48=US000402AJ19|22=1|167=2|461=DBFXXX|15=USD|541=20280515|223=3750"
  },
  simple: {
    name: "Simple Equity",
    description: "Basic equity instrument with minimal fields",
    fix: "55=AAPL|48=US0378331005|22=1|167=3|15=USD"
  }
};

// FIX Tag reference
const FIX_TAGS: Record<string, { name: string; description: string }> = {
  "8": { name: "BeginString", description: "FIX protocol version (session - excluded)" },
  "9": { name: "BodyLength", description: "Message length (session - excluded)" },
  "10": { name: "CheckSum", description: "Message checksum (session - excluded)" },
  "15": { name: "Currency", description: "Currency of the instrument" },
  "22": { name: "SecurityIDSource", description: "Source of SecurityID (1=CUSIP, 4=ISIN)" },
  "35": { name: "MsgType", description: "Message type (d=Security Definition)" },
  "48": { name: "SecurityID", description: "Primary security identifier" },
  "55": { name: "Symbol", description: "Ticker or common symbol" },
  "167": { name: "SecurityType", description: "Type of security (TBOND, CORP, CS, etc.)" },
  "223": { name: "CouponRate", description: "Interest rate for fixed income" },
  "447": { name: "PartyIDSource", description: "Source of PartyID" },
  "448": { name: "PartyID", description: "Party identifier" },
  "452": { name: "PartyRole", description: "Role of the party (1=Issuer, 24=Trustee)" },
  "453": { name: "NoPartyIDs", description: "Number of party entries" },
  "454": { name: "NoSecurityAltID", description: "Number of alternative security IDs" },
  "455": { name: "SecurityAltID", description: "Alternative security identifier" },
  "456": { name: "SecurityAltIDSource", description: "Source of alternative ID" },
  "461": { name: "CFICode", description: "ISO 10962 Classification of Financial Instruments" },
  "541": { name: "MaturityDate", description: "Maturity date (YYYYMMDD)" },
  "802": { name: "NoPartySubIDs", description: "Number of party sub-identifiers" }
};

// Educational Components
function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  const [show, setShow] = useState(false);
  
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          borderBottom: '1px dotted rgba(255,255,255,0.5)',
          cursor: 'help',
          color: 'rgba(96, 165, 250, 0.9)'
        }}
      >
        {children}
      </span>
      {show && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '0.5rem',
          padding: '0.75rem 1rem',
          background: 'rgba(20, 20, 20, 0.98)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px',
          fontSize: '0.875rem',
          lineHeight: '1.5',
          color: 'rgba(255,255,255,0.9)',
          whiteSpace: 'normal',
          width: 'max-content',
          maxWidth: '300px',
          zIndex: 1000,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
          pointerEvents: 'none'
        }}>
          {content}
          <span style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid rgba(20, 20, 20, 0.98)'
          }} />
        </span>
      )}
    </span>
  );
}

// Tree Node Component
function TreeNode({ 
  node, 
  level = 0, 
  onToggle,
  onPathClick 
}: { 
  node: TreeNodeData; 
  level?: number; 
  onToggle?: (path: number[]) => void;
  onPathClick?: (path: number[]) => void;
}) {
  const indent = level * 24;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div style={{ marginLeft: `${indent}px` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.5rem 0.75rem',
          background: level % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
          borderRadius: '4px',
          cursor: hasChildren || node.path ? 'pointer' : 'default',
          transition: 'background 0.2s'
        }}
        onClick={() => {
          if (hasChildren && node.path && onToggle) {
            onToggle(node.path);
          } else if (node.type === 'scalar' && node.path && onPathClick) {
            onPathClick(node.path);
          }
        }}
        onMouseEnter={(e) => {
          if (hasChildren || node.path) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = level % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
        }}
      >
        {hasChildren && (
          <span style={{ 
            marginRight: '0.5rem', 
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.5)',
            width: '12px'
          }}>
            {node.isExpanded ? '▼' : '▶'}
          </span>
        )}
        {!hasChildren && <span style={{ width: '20px' }} />}
        
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {node.type === 'root' && (
            <span style={{ fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>
              FIX Descriptor
            </span>
          )}
          
          {node.type === 'entry' && (
            <span style={{ 
              fontSize: '0.875rem', 
              color: 'rgba(255,255,255,0.6)',
              fontFamily: 'ui-monospace, monospace'
            }}>
              {node.name}
            </span>
          )}
          
          {(node.type === 'scalar' || node.type === 'group') && (
            <>
              <span style={{ 
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.875rem',
                color: 'rgba(255,255,255,0.7)',
                minWidth: '30px'
              }}>
                {node.tag}
              </span>
              {node.name && (
                <span style={{ 
                  fontSize: '0.75rem', 
                  color: 'rgba(255,255,255,0.4)'
                }}>
                  {node.name}
                </span>
              )}
              {node.value && (
                <span style={{ 
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.875rem',
                  color: 'rgba(255,255,255,0.9)',
                  marginLeft: 'auto'
                }}>
                  {node.value}
                </span>
              )}
              {node.type === 'group' && node.children && (
                <span style={{ 
                  fontSize: '0.75rem',
                  color: 'rgba(255,255,255,0.4)',
                  marginLeft: node.value ? '0.5rem' : 'auto'
                }}>
                  [{node.children.length} {node.children.length === 1 ? 'entry' : 'entries'}]
                </span>
              )}
            </>
          )}
          
          {node.path && node.type === 'scalar' && (
            <span style={{ 
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.3)',
              fontFamily: 'ui-monospace, monospace',
              marginLeft: 'auto'
            }}>
              {JSON.stringify(node.path)}
            </span>
          )}
        </div>
      </div>
      
      {hasChildren && node.isExpanded && node.children?.map((child, idx) => (
        <TreeNode 
          key={idx} 
          node={child} 
          level={level + 1} 
          onToggle={onToggle}
          onPathClick={onPathClick}
        />
      ))}
    </div>
  );
}

// Merkle Tree Visualization Component
function MerkleTreeNode({ 
  node, 
  level = 0,
  onLeafClick 
}: { 
  node: MerkleNodeData; 
  level?: number;
  onLeafClick?: (path: number[]) => void;
}) {
  const isLeaf = node.type === 'leaf';
  const isRoot = node.type === 'root';
  const childContainerRef = useRef<HTMLDivElement | null>(null);
  const [connectors, setConnectors] = useState<{ width: number; leftX: number | null; rightX: number | null }>({
    width: 0,
    leftX: null,
    rightX: null,
  });

  useLayoutEffect(() => {
    const container = childContainerRef.current;
    if (!container) return;

    const measure = () => {
      if (!childContainerRef.current) return;
      const width = childContainerRef.current.offsetWidth;
      const childElements = Array.from(childContainerRef.current.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.tagName.toLowerCase() !== 'svg'
      );
      const [leftEl, rightEl] = childElements;
      const next = {
        width,
        leftX: leftEl ? leftEl.offsetLeft + leftEl.offsetWidth / 2 : null,
        rightX: rightEl ? rightEl.offsetLeft + rightEl.offsetWidth / 2 : null,
      };

      setConnectors((prev) => {
        if (
          prev.width === next.width &&
          prev.leftX === next.leftX &&
          prev.rightX === next.rightX
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    Array.from(container.children).forEach((child) => observer.observe(child));

    return () => {
      observer.disconnect();
    };
  }, [node.left, node.right]);
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center',
      gap: '1.5rem',
      flexShrink: 0,
      minWidth: 'max-content'
    }}>
      {/* Node Box */}
      <div
        style={{
          padding: isRoot ? '1rem 1.5rem' : isLeaf ? '0.875rem 1.25rem' : '0.75rem 1.25rem',
          background: node.isHighlighted 
            ? 'rgba(255,255,255,0.1)' 
            : isRoot 
              ? 'rgba(255,255,255,0.05)'
              : 'rgba(255,255,255,0.03)',
          border: `1px solid ${node.isHighlighted 
            ? 'rgba(255,255,255,0.4)' 
            : isRoot
              ? 'rgba(255,255,255,0.2)'
              : 'rgba(255,255,255,0.1)'}`,
          borderRadius: isRoot ? '8px' : '6px',
          cursor: isLeaf && node.path ? 'pointer' : 'default',
          transition: 'all 0.2s',
          textAlign: 'center',
          minWidth: isLeaf ? '140px' : '160px',
          position: 'relative'
        }}
        onClick={() => {
          if (isLeaf && node.path && onLeafClick) {
            onLeafClick(node.path);
          }
        }}
        onMouseEnter={(e) => {
          if (isLeaf && node.path) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
          }
        }}
        onMouseLeave={(e) => {
          if (isLeaf && !node.isHighlighted) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
          }
        }}
      >
        {/* Node Type Label */}
        <div style={{ 
          fontSize: '0.65rem',
          color: 'rgba(255,255,255,0.4)',
          marginBottom: '0.5rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: '500'
        }}>
          {isRoot ? 'Root' : isLeaf ? 'Leaf' : 'Parent'}
        </div>
        
        {/* Tag and Value for leaves */}
        {isLeaf && node.tag && node.value && (
          <div style={{
            marginBottom: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}>
            <div style={{
              fontSize: '0.8rem',
              color: 'rgba(96, 165, 250, 0.9)',
              fontFamily: 'ui-monospace, monospace',
              fontWeight: '600'
            }}>
              Tag {node.tag}
            </div>
            {node.name && (
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: '0.15rem'
              }}>
                {node.name}
              </div>
            )}
            <div style={{
              fontSize: '0.75rem',
              color: 'rgba(255,255,255,0.8)',
              fontFamily: 'ui-monospace, monospace',
              fontWeight: '500'
            }}>
              = {node.value}
            </div>
          </div>
        )}

        {/* Path for leaves (shown smaller if tag/value present) */}
        {isLeaf && node.path && (
          <div style={{
            fontSize: '0.65rem',
            color: 'rgba(255,255,255,0.4)',
            marginBottom: '0.5rem',
            fontFamily: 'ui-monospace, monospace',
            fontWeight: '400'
          }}>
            Path: {JSON.stringify(node.path)}
          </div>
        )}

        {/* Hash Value */}
        <div style={{
          fontSize: isRoot ? '0.8rem' : '0.75rem',
          fontFamily: 'ui-monospace, monospace',
          color: node.isHighlighted ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)',
          wordBreak: 'break-all',
          lineHeight: '1.4',
          fontWeight: node.isHighlighted ? '500' : '400'
        }}>
          {isRoot ? node.hash : `${node.hash.slice(0, 12)}...`}
        </div>
      </div>
      
      {/* Children */}
      {(node.left || node.right) && (
        <div
          style={{ 
            position: 'relative', 
            display: 'flex', 
            gap: '3rem',
            flexShrink: 0,
            minWidth: 'max-content'
          }}
          ref={childContainerRef}
        >
          {/* Connecting Lines */}
          <svg 
            style={{ 
              position: 'absolute', 
              top: '-1.5rem', 
              left: '50%',
              transform: 'translateX(-50%)',
              width: `${Math.max(connectors.width, 1)}px`,
              height: '1.5rem',
              pointerEvents: 'none',
              overflow: 'visible'
            }}
            viewBox={`0 0 ${Math.max(connectors.width, 1)} 30`}
            preserveAspectRatio="xMidYMin meet"
          >
            {connectors.width > 0 && connectors.leftX !== null && (
              <path
                d={`M ${connectors.width / 2} 0 Q ${(connectors.width / 2 + connectors.leftX) / 2} 10 ${connectors.leftX} 30`}
                fill="none"
                stroke={node.isHighlighted ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}
                strokeWidth={node.isHighlighted ? '2' : '1.5'}
              />
            )}
            {connectors.width > 0 && connectors.rightX !== null && (
              <path
                d={`M ${connectors.width / 2} 0 Q ${(connectors.width / 2 + connectors.rightX) / 2} 10 ${connectors.rightX} 30`}
                fill="none"
                stroke={node.isHighlighted ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}
                strokeWidth={node.isHighlighted ? '2' : '1.5'}
              />
            )}
          </svg>
          
          {/* Child Nodes */}
          {node.left && (
            <MerkleTreeNode 
              node={node.left} 
              level={level + 1} 
              onLeafClick={onLeafClick} 
            />
          )}
          {node.right && (
            <MerkleTreeNode 
              node={node.right} 
              level={level + 1} 
              onLeafClick={onLeafClick} 
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const [fixRaw, setFixRaw] = useState('');
  const [schemaInput, setSchemaInput] = useState('');
  const [availableMessageTypes, setAvailableMessageTypes] = useState<Array<{ name: string; msgType: string }>>([]);
  const [selectedMessageType, setSelectedMessageType] = useState('SecurityDefinition');
  const [parsedOrchestra, setParsedOrchestra] = useState<{
    messageName: string;
    messageId: string;
    msgType: string;
    fields: Array<{ id: string; name: string; type: string; sbeType: string }>;
  } | null>(null);
  const [orchestraError, setOrchestraError] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<Array<{ name: string; id: string; msgType: string }>>([]);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(0);
  const [messageBuilderValues, setMessageBuilderValues] = useState<Record<string, string | string[]>>({});
  const [generatedSbeSchema, setGeneratedSbeSchema] = useState<string>('');
  const [fullSbeSchema, setFullSbeSchema] = useState<string>('');
  const [currentMessageId, setCurrentMessageId] = useState<string>('');
  const [orchestraFieldDictionary, setOrchestraFieldDictionary] = useState<Map<string, { name: string; type: string }>>(new Map());
  
  // Extract available message types when Orchestra schema is loaded
  useEffect(() => {
    if (!schemaInput.trim()) {
      setAvailableMessageTypes([]);
      return;
    }
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(schemaInput, 'text/xml');
      
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        return;
      }
      
      // Extract all message definitions
      const messageTypes: Array<{ name: string; msgType: string }> = [];
      const messages = doc.getElementsByTagName('*');
      for (let i = 0; i < messages.length; i++) {
        const el = messages[i];
        const localName = el.localName || el.tagName.split(':').pop();
        if (localName === 'message') {
          const name = el.getAttribute('name');
          const msgType = el.getAttribute('msgType');
          if (name && msgType) {
            messageTypes.push({ name, msgType });
          }
        }
      }
      
      console.log(`Found ${messageTypes.length} message types in Orchestra`);
      setAvailableMessageTypes(messageTypes);
      
      // Set default if not already set
      if (messageTypes.length > 0 && !messageTypes.find(m => m.name === selectedMessageType)) {
        setSelectedMessageType(messageTypes[0].name);
      }
    } catch (error) {
      console.error('Failed to extract message types:', error);
    }
  }, [schemaInput]);
  
  // Parse Orchestra XML when schema input or message type changes
  useEffect(() => {
    if (!schemaInput.trim()) {
      setParsedOrchestra(null);
      setOrchestraError(null);
      return;
    }
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(schemaInput, 'text/xml');
      
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        setOrchestraError('Invalid XML syntax');
        setParsedOrchestra(null);
        return;
      }
      
      // Build field dictionary from <fields> section ONLY (repository-style Orchestra)
      const fieldDictionary = new Map<string, { name: string; type: string }>();
      
      // Find the <fields> container element first
      let fieldsContainer: Element | null = null;
      let fieldsContainerList = doc.getElementsByTagName('fields');
      if (fieldsContainerList.length === 0) {
        fieldsContainerList = doc.getElementsByTagName('fixr:fields');
      }
      if (fieldsContainerList.length > 0) {
        fieldsContainer = fieldsContainerList[0];
        
        // Only get field elements that are direct children of the fields container
        const children = fieldsContainer.children;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const tagName = child.tagName.toLowerCase();
          if (tagName === 'field' || tagName === 'fixr:field') {
            const id = child.getAttribute('id');
            const name = child.getAttribute('name');
            const type = child.getAttribute('type');
            if (id && name && type) {
              fieldDictionary.set(id, { name, type });
            }
          }
        }
      }
      
      // Get components (for resolving component references)
      let components = doc.getElementsByTagName('component');
      if (components.length === 0) {
        components = doc.getElementsByTagName('fixr:component');
      }
      
      // Find the selected message definition
      let messageElement: Element | null = null;
      const messages = doc.getElementsByTagName('*');
      for (let i = 0; i < messages.length; i++) {
        const el = messages[i];
        const localName = el.localName || el.tagName.split(':').pop();
        if (localName === 'message' && el.getAttribute('name') === selectedMessageType) {
          messageElement = el;
          break;
        }
      }
      
      if (!messageElement) {
        console.error(`Message type "${selectedMessageType}" not found in Orchestra XML`);
        setOrchestraError(`Message type "${selectedMessageType}" not found in Orchestra XML`);
        setParsedOrchestra(null);
        setAllMessages([]);
        return;
      }
      
      console.log(`Found message element for ${selectedMessageType}`);
      
      const messageName = messageElement.getAttribute('name') || 'Unknown';
      const messageId = messageElement.getAttribute('id') || '?';
      const msgType = messageElement.getAttribute('msgType') || '?';
      
      const fields: Array<{ id: string; name: string; type: string; sbeType: string }> = [];
      const fieldIds = new Set<string>();
      
      // Find structure element
      let structure: Element | null = null;
      for (let i = 0; i < messageElement.children.length; i++) {
        const child = messageElement.children[i];
        const tagName = child.tagName.toLowerCase();
        if (tagName === 'structure' || tagName === 'fixr:structure') {
          structure = child;
          break;
        }
      }
      
      if (!structure) {
        console.error(`No structure found for message "${selectedMessageType}"`);
        setOrchestraError(`No structure found for message "${selectedMessageType}"`);
        setParsedOrchestra(null);
        return;
      }
      
      console.log(`Found structure for ${selectedMessageType}`);
      
      // Get groups for resolving group references
      let groups = doc.getElementsByTagName('group');
      if (groups.length === 0) {
        groups = doc.getElementsByTagName('fixr:group');
      }
      
      // Helper function to recursively extract fields from an element
      const extractFieldsFromElement = (element: Element): void => {
        for (let i = 0; i < element.children.length; i++) {
          const child = element.children[i];
          const localName = (child.localName || child.tagName.split(':').pop() || '').toLowerCase();
          
          if (localName === 'fieldref') {
            const id = child.getAttribute('id');
            if (id) {
              console.log(`Found fieldRef: ${id}`);
              fieldIds.add(id);
            }
          } else if (localName === 'componentref') {
            // Resolve component reference
            const compId = child.getAttribute('id');
            if (compId) {
              console.log(`Resolving componentRef: ${compId}`);
              const comp = Array.from(components).find(c => c.getAttribute('id') === compId);
              if (comp) {
                extractFieldsFromElement(comp);
              } else {
                console.warn(`Component ${compId} not found`);
              }
            }
          } else if (localName === 'groupref') {
            // Resolve group reference
            const groupId = child.getAttribute('id');
            if (groupId) {
              console.log(`Resolving groupRef: ${groupId}`);
              const group = Array.from(groups).find(g => g.getAttribute('id') === groupId);
              if (group) {
                extractFieldsFromElement(group);
              } else {
                console.warn(`Group ${groupId} not found`);
              }
            }
          }
        }
      };
      
      console.log(`Starting field extraction from structure with ${structure.children.length} children`);
      // Extract fields from the message structure
      extractFieldsFromElement(structure);
      console.log(`Field extraction complete, found ${fieldIds.size} field IDs`);
      
      // Convert field IDs to field definitions
      for (const id of fieldIds) {
        if (fieldDictionary.has(id)) {
          const fieldDef = fieldDictionary.get(id)!;
          fields.push({ id, name: fieldDef.name, type: fieldDef.type, sbeType: '→ will be converted' });
        }
      }
      
      // Sort fields by numeric ID
      fields.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      
      console.log(`Extracted ${fields.length} fields for ${selectedMessageType}:`, fields.map(f => `${f.id}:${f.name}`).join(', '));
      
      if (fields.length === 0) {
        console.warn(`No fields found for message "${selectedMessageType}". Message may use nested groups.`);
        setOrchestraError(`No fields found for message "${selectedMessageType}". Message may use nested groups.`);
      } else {
        setOrchestraError(null);
      }
      
      setParsedOrchestra({ messageName, messageId, msgType, fields });
      setAllMessages([]);
      
      // Store the field dictionary for tag name resolution
      setOrchestraFieldDictionary(fieldDictionary);
    } catch (error) {
      setOrchestraError(error instanceof Error ? error.message : 'Parse error');
      setParsedOrchestra(null);
    }
  }, [schemaInput, selectedMessageType]);
  
  // Parse FIX raw input and populate message builder (supports repeated tags)
  useEffect(() => {
    if (!fixRaw.trim()) return;
    const fields: Record<string, string | string[]> = {};
    const pairs = fixRaw.split('|');
    
    for (const pair of pairs) {
      const [tag, value] = pair.split('=');
      if (!tag) continue;
      if (fields[tag] === undefined) {
        fields[tag] = value;
        continue;
      }
      const existing = fields[tag];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fields[tag] = [existing, value];
      }
    }
    
    // Merge with existing values (append, don't replace)
    setMessageBuilderValues(prev => ({
      ...prev,
      ...fields
    }));
  }, [fixRaw]);

  // Auto-select message type based on MsgType (35=) in FIX input
  useEffect(() => {
    if (!fixRaw.trim() || !schemaInput.trim()) return;
    const msgTypeMatch = fixRaw.split('|').find(part => part.startsWith('35='));
    if (!msgTypeMatch) return;
    const msgType = msgTypeMatch.split('=')[1];
    if (!msgType) return;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(schemaInput, 'text/xml');
      const messages = doc.getElementsByTagName('*');
      let foundName: string | null = null;
      for (let i = 0; i < messages.length; i++) {
        const el = messages[i];
        const localName = el.localName || el.tagName.split(':').pop();
        if (localName === 'message' && el.getAttribute('msgType') === msgType) {
          foundName = el.getAttribute('name');
          break;
        }
      }
      if (foundName && foundName !== selectedMessageType) {
        setSelectedMessageType(foundName);
      }
    } catch (error) {
      console.warn('Failed to infer message type from FIX input:', error);
    }
  }, [fixRaw, schemaInput, selectedMessageType]);

  // Auto-generate full SBE schema when Orchestra is loaded
  useEffect(() => {
    if (schemaInput.trim()) {
      try {
        // Generate full SBE schema with ALL message types
        const fullSchema = orchestraToSbeFullSchema(schemaInput);
        setFullSbeSchema(fullSchema);
        console.log('Generated full SBE schema with all messages');
      } catch (error) {
        console.error('Failed to generate full SBE schema:', error);
        setFullSbeSchema('');
      }
    } else {
      setFullSbeSchema('');
    }
  }, [schemaInput]);

  // Auto-generate single-message SBE schema and extract messageId when message type changes
  useEffect(() => {
    if (schemaInput.trim() && selectedMessageType && fullSbeSchema) {
      try {
        // Generate SBE schema for the selected message type (for preview)
        const sbeSchema = orchestraToSbe(schemaInput, selectedMessageType);
        setGeneratedSbeSchema(sbeSchema);
        
        // Extract messageId from the full schema for the selected message type
        const messageId = extractMessageIdFromSbe(fullSbeSchema, selectedMessageType);
        if (messageId) {
          setCurrentMessageId(messageId);
          console.log(`Message ID for ${selectedMessageType}: ${messageId}`);
        } else {
          console.warn(`Could not find message ID for ${selectedMessageType}`);
          setCurrentMessageId('');
        }
      } catch (error) {
        console.error('Failed to generate SBE schema:', error);
        setGeneratedSbeSchema(`<!-- Error generating schema: ${error instanceof Error ? error.message : 'Unknown error'} -->`);
        setCurrentMessageId('');
      }
    } else {
      setGeneratedSbeSchema('');
      setCurrentMessageId('');
    }
  }, [schemaInput, selectedMessageType, fullSbeSchema]);
  
  type ParsedFieldNode = {
    tag?: string;
    name?: string;
    value?: string;
    type: 'scalar' | 'group' | 'entry';
    children?: ParsedFieldNode[];
  };

  const [preview, setPreview] = useState<{ 
    root: string; 
    sbeHex: string;
    sbeBase64: string; 
    leavesCount: number; 
    paths: number[][]; 
    merkleTree: MerkleNodeData;
    treeData?: TreeNodeData;
    parsedFields?: ParsedFieldNode[];
  } | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [proof, setProof] = useState<ProofResult>(null);
  const [txInfo, setTxInfo] = useState<React.ReactNode>('');
  const [proofVerificationInfo, setProofVerificationInfo] = useState<React.ReactNode>('');
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [treeData, setTreeData] = useState<TreeNodeData | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'hex' | 'tree' | 'merkle'>('hex');
  const [isSticky, setIsSticky] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  
  // Refs for sections
  const introRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const messageTypeRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const deployRef = useRef<HTMLDivElement>(null);
  const proofRef = useRef<HTMLDivElement>(null);
  const proofResultsRef = useRef<HTMLDivElement>(null);
  const retrieveRef = useRef<HTMLDivElement>(null);
  const progressIndicatorRef = useRef<HTMLDivElement>(null);
  
  // Token deployment state
  const [showTokenDeploy, setShowTokenDeploy] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenSupply, setTokenSupply] = useState('1000000');
  const [deployedTokenAddress, setDeployedTokenAddress] = useState<string | null>(null);
  const [onChainVerificationStatus, setOnChainVerificationStatus] = useState<'pending' | 'success' | 'failed' | null>(null);
  
  // Background verification state
  const [verificationNotification, setVerificationNotification] = useState<{
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    show: boolean;
  } | null>(null);

  // SBE fetching state
  const [fetchedSBE, setFetchedSBE] = useState<string | null>(null);
  const [decodedFIX, setDecodedFIX] = useState<string | null>(null);
  const [decodedFIXNamed, setDecodedFIXNamed] = useState<string | null>(null);
  const [fetchSBEStatus, setFetchSBEStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [fetchSBEError, setFetchSBEError] = useState<string | null>(null);
  
  // Human-readable output state
  const [offchainFormat, setOffchainFormat] = useState<'numeric' | 'named'>('numeric');


  // Sticky progress indicator
  const [progressOriginalTop, setProgressOriginalTop] = useState<number>(0);
  
  useEffect(() => {
    if (progressIndicatorRef.current && progressOriginalTop === 0) {
      setProgressOriginalTop(progressIndicatorRef.current.offsetTop);
    }
  }, [progressOriginalTop]);

  useEffect(() => {
    const handleScroll = () => {
      if (progressOriginalTop > 0) {
        setIsSticky(window.scrollY > progressOriginalTop - 20);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial position

    return () => window.removeEventListener('scroll', handleScroll);
  }, [progressOriginalTop]);

  // Get sticky header offset dynamically
  const getStickyHeaderOffset = useCallback(() => {
    if (progressIndicatorRef.current) {
      // Get the actual height of the sticky header and add a small buffer
      return -(progressIndicatorRef.current.offsetHeight * 1.3);
    }
    return -180; // Fallback value
  }, []);

  // Auto-scroll helper
  const scrollToSection = useCallback((ref: React.RefObject<HTMLDivElement | null>, offset?: number) => {
    if (ref.current) {
      const actualOffset = offset ?? getStickyHeaderOffset();
      const top = ref.current.getBoundingClientRect().top + window.scrollY + actualOffset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [getStickyHeaderOffset]);

  // Map step index to section ref
  const getStepSectionRef = useCallback((stepIndex: number) => {
    switch (stepIndex) {
      case 0: return inputRef; // Input
      case 1: 
      case 2:
      case 3:
      case 4: return resultsRef; // Parse, Canonicalize, Encode, Merkle
      case 5: return deployRef; // Deploy
      case 6: return proofRef; // Verify
      case 7: return retrieveRef; // Retrieve
      default: return null;
    }
  }, [inputRef, resultsRef, deployRef, proofRef, retrieveRef]);

  const steps = [
    { 
      name: "Input", 
      description: "FIX Message",
      phase: "offchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
    },
    { 
      name: "Parse", 
      description: "Extract Fields",
      phase: "offchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      )
    },
    { 
      name: "Canonicalize", 
      description: "Build Tree",
      phase: "offchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )
    },
    { 
      name: "Encode", 
      description: "SBE Binary",
      phase: "offchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      )
    },
    { 
      name: "Merkle", 
      description: "Generate Root",
      phase: "offchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="2" />
          <path d="M12 10v4" />
          <circle cx="8" cy="16" r="2" />
          <circle cx="16" cy="16" r="2" />
          <path d="M12 14l-2 2" />
          <path d="M12 14l2 2" />
        </svg>
      )
    },
    { 
      name: "Deploy", 
      description: "Onchain",
      phase: "onchain",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      )
    },
    { 
      name: "Verify", 
      description: "Merkle Proof",
      phase: "verification",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )
    },
    { 
      name: "Retrieve", 
      description: "Offchain",
      phase: "verification",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )
    }
  ];

  const phases = [
    { id: "offchain", label: "Off-chain Processing", color: "rgba(168, 85, 247, 0.6)" },
    { id: "onchain", label: "On-chain", color: "rgba(59, 130, 246, 0.6)" },
    { id: "verification", label: "Verification", color: "rgba(34, 197, 94, 0.6)" }
  ];

  const stepsContainerRef = useRef<HTMLDivElement | null>(null);
  const stepIconRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [, setStepGeometry] = useState<{ width: number; edges: Array<{ left: number; right: number }> }>({ width: 0, edges: [] });

  useLayoutEffect(() => {
    const container = stepsContainerRef.current;
    if (!container) return;

    const measure = () => {
      if (!stepsContainerRef.current) return;
      const containerRect = stepsContainerRef.current.getBoundingClientRect();
      const edges = stepIconRefs.current.map((el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left - containerRect.left,
          right: rect.right - containerRect.left
        };
      }).filter((value): value is { left: number; right: number } => value !== null);

      setStepGeometry((prev) => {
        const width = containerRect.width;
        if (
          prev.width === width &&
          prev.edges.length === edges.length &&
          prev.edges.every((edge, idx) => edge.left === edges[idx].left && edge.right === edges[idx].right)
        ) {
          return prev;
        }
        return { width, edges };
      });
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(container);
      stepIconRefs.current.forEach((el) => el && observer.observe(el));
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [steps.length]);


  async function doPreview() {
    setProof(null);
    setOnChainVerificationStatus(null); // Reset verification status when preview changes
    setLoading(true);
    setLoadingMessage('Parsing FIX message...');
    setCurrentStep(1);
    
    try {
      // Use the full SBE schema with all messages
      if (!fullSbeSchema) {
        alert('SBE schema not available. Please ensure Orchestra XML is valid.');
        setCurrentStep(0);
        setLoadingMessage('');
        setLoading(false);
        return;
      }
      
      if (!currentMessageId) {
        alert('Message ID not available. Please select a valid message type.');
        setCurrentStep(0);
        setLoadingMessage('');
        setLoading(false);
        return;
      }
      
      // Simulate step-by-step feedback
      setTimeout(() => setLoadingMessage('Building canonical tree...'), 300);
      setTimeout(() => setLoadingMessage('Encoding to SBE...'), 600);
      setTimeout(() => setLoadingMessage('Generating Merkle tree...'), 900);
      
      const res = await fetch('/api/preview', { 
        method: 'POST', 
        headers: { 'content-type': 'application/json' }, 
        body: JSON.stringify({ 
          fixRaw,
          schema: fullSbeSchema,
          messageId: currentMessageId
        }) 
      });
      
    if (!res.ok) {
      const text = await res.text();
      alert(`Preview failed: ${text}`);
        setCurrentStep(0);
        setLoadingMessage('');
      return;
    }
      
    const json = await res.json();
    setPreview(json);
      setCurrentStep(4);
      setLoadingMessage('');
      
      // Use tree data from backend
      if (json.treeData) {
        setTreeData(json.treeData);
        setExpandedNodes(new Set(['[]'])); // Expand root by default
      }
      
      // Auto-scroll to results
      setTimeout(() => {
        scrollToSection(resultsRef);
      }, 100);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  }

  async function doProof() {
    if (!preview) return;
    setLoading(true);
    setOnChainVerificationStatus(null); // Reset verification status when generating new proof
    
    try {
      const parsedPath = JSON.parse(pathInput || '[]');
      const res = await fetch('/api/proof', { 
        method: 'POST', 
        headers: { 'content-type': 'application/json' }, 
        body: JSON.stringify({ 
          fixRaw, 
          path: parsedPath,
          schema: fullSbeSchema || generatedSbeSchema,
          messageId: currentMessageId
        }) 
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Proof generation failed');
      }
      
      const json: ProofResult = await res.json();
      setProof(json);
      
      // Auto-scroll to proof results
      setTimeout(() => {
        scrollToSection(proofResultsRef);
      }, 100);
    } catch (error) {
      console.error('Proof generation error:', error);
      alert(`Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setProof(null);
    } finally {
      setLoading(false);
    }
  }

  // Background verification function that runs independently
  async function verifyContractInBackground(
    tokenAddress: string,
    transactionHash: string,
    blockNumber: string
  ) {
    const factoryAddress = process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS;
    const supplyInWei = BigInt(tokenSupply) * BigInt(10 ** 18);
    const maxRetries = 10;
    
    // Create public client for checking block numbers
    const publicClient = createPublicClient({
      chain: chainFromEnv,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL)
    });
    
    let currentBlockNumber = BigInt(blockNumber);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const verifyResponse = await fetch('/api/verify-contract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contractAddress: tokenAddress,
            tokenName,
            tokenSymbol,
            initialSupply: supplyInWei.toString(),
            initialOwner: factoryAddress,
            chainId: chainFromEnv.id,
          }),
        });

        const verifyResult = await verifyResponse.json();

        if (verifyResult.success) {
          setVerificationNotification({
            message: `Contract source code verified on Etherscan!`,
            type: 'success',
            show: true
          });
          // Auto-hide after 10 seconds
          setTimeout(() => {
            setVerificationNotification(null);
          }, 10000);
          return;
        }

        // Check if we should retry
        if (attempt < maxRetries) {
          // Wait for next block before retry
          const targetBlock = currentBlockNumber + BigInt(1);
          let newBlock = currentBlockNumber;
          
          while (newBlock < targetBlock) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              newBlock = await publicClient.getBlockNumber();
              if (newBlock > currentBlockNumber) {
                currentBlockNumber = newBlock;
                break;
              }
            } catch (blockError) {
              console.error('Error checking block number:', blockError);
            }
          }
          
          continue;
        }

        // Last attempt failed
        setVerificationNotification({
          message: `⚠ Contract source code verification on Etherscan failed after ${maxRetries} attempts. You can verify manually on the block explorer.`,
          type: 'warning',
          show: true
        });
        // Auto-hide after 15 seconds
        setTimeout(() => {
          setVerificationNotification(null);
        }, 15000);

      } catch (verifyError) {
        console.error(`Verification attempt ${attempt} error:`, verifyError);
        
        if (attempt < maxRetries) {
          // Wait for next block
          const targetBlock = currentBlockNumber + BigInt(1);
          let newBlock = currentBlockNumber;
          
          while (newBlock < targetBlock) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              newBlock = await publicClient.getBlockNumber();
              if (newBlock > currentBlockNumber) {
                currentBlockNumber = newBlock;
                break;
              }
            } catch (blockError) {
              console.error('Error checking block number:', blockError);
            }
          }
          
          continue;
        }
        
        // Last attempt failed
        setVerificationNotification({
          message: `⚠ Contract source code verification on Etherscan encountered an error. You can verify manually on the block explorer.`,
          type: 'error',
          show: true
        });
        // Auto-hide after 15 seconds
        setTimeout(() => {
          setVerificationNotification(null);
        }, 15000);
      }
    }
  }

  async function deployWithFactory() {
    if (!preview) {
      alert('Please generate preview first');
      return;
    }

    if (!tokenName || !tokenSymbol || !tokenSupply) {
      alert('Please fill in all token fields');
      return;
    }

    try {
      setLoading(true);
      setTxInfo('Submitting deployment to backend...');

      // Call backend API to deploy token
      const response = await fetch('/api/deploy-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: tokenName,
          symbol: tokenSymbol,
          initialSupply: tokenSupply,
          sbeHex: preview.sbeHex,
          root: preview.root,
          schemaXml: fullSbeSchema || generatedSbeSchema
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Deployment failed');
      }

      const { transactionHash, tokenAddress, blockNumber } = data;

      setDeployedTokenAddress(tokenAddress);

      // Show deployment success message
      setTxInfo(
        <div>
          <div style={{ marginBottom: '1rem', fontWeight: '600' }}>Token deployed successfully!</div>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Token Address: </span>
            <AddressLink address={tokenAddress} chainId={chainFromEnv.id} />
          </div>
          <div style={{ marginBottom: '0.5rem', color: 'rgba(34, 197, 94, 0.9)' }}>
            ✓ SBE Data Deployed<br />
            ✓ Descriptor Set
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Transaction: </span>
            <TransactionLink hash={transactionHash} chainId={chainFromEnv.id} />
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>
            Block: {blockNumber}
          </div>
          <div style={{ marginTop: '1rem', color: 'rgba(255,255,255,0.8)' }}>
            Contract source code verification on Etherscan will continue in the background...
          </div>
        </div>
      );

      // Start background verification (non-blocking)
      setVerificationNotification({
        message: 'Verifying contract source code on Etherscan...',
        type: 'info',
        show: true
      });
      
      // Run verification in background - don't await
      verifyContractInBackground(tokenAddress, transactionHash, blockNumber);

      // Close modal after short delay to show success message
      setTimeout(() => {
        setShowTokenDeploy(false);
      }, 2000);
      
      setCurrentStep(5); // Update step indicator to show deployment complete
      
      // Reset form
      setTokenName('');
      setTokenSymbol('');
      setTokenSupply('1000000');
      
    } catch (error) {
      console.error('Deployment failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTxInfo(`Deployment failed: ${errorMessage}`);
      alert(`Deployment failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSBEFromContract() {
    if (!deployedTokenAddress) {
      setFetchSBEError('Please deploy a token first');
      return;
    }

    try {
      setFetchSBEStatus('loading');
      setFetchSBEError(null);
      setFetchedSBE(null);
      setDecodedFIX(null);

      const publicClient = createPublicClient({
        chain: chainFromEnv,
        transport: http()
      });

      type Abi = readonly unknown[];
      const tokenAbi: Abi = AssetTokenAbi;

      // First get the descriptor to know the SBE data length and validate it exists
      let descriptor;
      try {
        descriptor = await publicClient.readContract({
          address: deployedTokenAddress as `0x${string}`,
          abi: tokenAbi,
          functionName: 'getFixDescriptor',
          args: []
        }) as { fixSBELen: number; fixSBEPtr: string };
      } catch (descriptorError) {
        const errorMsg = descriptorError instanceof Error ? descriptorError.message : 'Unknown error';
        if (errorMsg.includes('Descriptor not initialized')) {
          throw new Error('The token descriptor has not been initialized. Please deploy a new token with the "Quick Deploy Token" button.');
        }
        throw descriptorError;
      }

      const sbeLength = Number(descriptor.fixSBELen);
      const sbePtr = descriptor.fixSBEPtr;

      // Validate SBE data exists
      if (!sbePtr || sbePtr === '0x0000000000000000000000000000000000000000') {
        throw new Error('SBE data pointer is not set. The descriptor was not properly deployed.');
      }

      if (sbeLength === 0) {
        throw new Error('SBE length is 0. The descriptor is empty.');
      }

      // Fetch the SBE data in one call
      let sbeBytes;
      try {
        sbeBytes = await publicClient.readContract({
          address: deployedTokenAddress as `0x${string}`,
          abi: tokenAbi,
          functionName: 'getFixSBEChunk',
          args: [BigInt(0), BigInt(sbeLength)]
        }) as `0x${string}`;
      } catch (chunkError) {
        const errorMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
        if (errorMsg.includes('No SBE data') || errorMsg.includes('SBE not deployed')) {
          throw new Error('The SBE data contract is empty. This can happen if the deployment failed or the data was not properly stored.');
        }
        throw chunkError;
      }

      setFetchedSBE(sbeBytes);

      if (!fullSbeSchema) {
        throw new Error('No SBE schema available. Please load an Orchestra schema first.');
      }

      // Decode SBE via API endpoint
      const decodeResponse = await fetch('/api/decode-sbe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          encodedMessage: sbeBytes,
          schema: fullSbeSchema
        })
      });

      if (!decodeResponse.ok) {
        const errorData = await decodeResponse.json();
        throw new Error(errorData.error || 'Failed to decode');
      }

      const decodeResult = await decodeResponse.json();
      if (decodeResult?.error) {
        throw new Error(`SBE decoding failed: ${decodeResult.error}`);
      }

      // Convert numeric tags to tag names for the named version using Orchestra schema
      const namedMessage = decodeResult.fixMessage
        .split('|')
        .map((pair: string) => {
          const [tag, value] = pair.split('=');
          const tagInfo = orchestraFieldDictionary.get(tag);
          if (tagInfo) {
            return `${tagInfo.name}=${value}`;
          }
          return pair; // Keep original if tag not found
        })
        .join('|');

      setDecodedFIX(decodeResult.fixMessage);
      setDecodedFIXNamed(namedMessage);
      setFetchSBEStatus('success');
      setCurrentStep(7); // Update step indicator to show retrieval complete

    } catch (error) {
      console.error('Failed to fetch SBE:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFetchSBEError(errorMessage);
      setFetchSBEStatus('error');
    }
  }

  async function verifyProofOnChain() {
    if (!proof || !deployedTokenAddress) {
      alert('Please generate a proof and deploy a token first');
      return;
    }

    try {
      setLoading(true);
      setOnChainVerificationStatus('pending');
      
      const publicClient = createPublicClient({
        chain: chainFromEnv,
        transport: http()
      });

      type Abi = readonly unknown[];
      const tokenAbi: Abi = AssetTokenAbi;

      // First, check if the descriptor is initialized by trying to get the root
      let descriptorRoot;
      try {
        descriptorRoot = await publicClient.readContract({
          address: deployedTokenAddress as `0x${string}`,
          abi: tokenAbi,
          functionName: 'getFixRoot',
          args: []
        });
      } catch (rootError) {
        const errorMsg = rootError instanceof Error ? rootError.message : 'Unknown error';
        if (errorMsg.includes('Descriptor not initialized')) {
          setOnChainVerificationStatus('failed');
          setProofVerificationInfo(`Descriptor Not Initialized\n\nThe token at ${deployedTokenAddress} does not have a descriptor set yet.\n\nThis can happen if:\n- The token was deployed without a descriptor\n- The descriptor setup transaction failed\n- You're using a different token\n\nTry deploying a new token using the "Quick Deploy Token" button.`);
          return;
        }
        throw rootError;
      }

      // Now verify the proof
      const isValid = await publicClient.readContract({
        address: deployedTokenAddress as `0x${string}`,
        abi: tokenAbi,
        functionName: 'verifyField',
        args: [
          proof.pathCBORHex as `0x${string}`,
          proof.valueHex as `0x${string}`,
          proof.proof.map(p => p as `0x${string}`),
          proof.directions
        ]
      });

      if (isValid) {
        setOnChainVerificationStatus('success');
        setCurrentStep(6); // Update step indicator to show verification complete
        setProofVerificationInfo(
          <div>
            <div style={{ marginBottom: '1rem', fontWeight: '600' }}>Merkle Proof Verified Onchain!</div>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Token Address: </span>
              <AddressLink address={deployedTokenAddress} chainId={chainFromEnv.id} />
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Descriptor Root: </span>
              <code style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{String(descriptorRoot)}</code>
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Path: </span>
              <code style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.85em', wordBreak: 'break-all' }}>{proof.pathCBORHex}</code>
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Value: </span>
              <code style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.85em', wordBreak: 'break-all' }}>{proof.valueHex}</code>
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Proof Length: </span>
              <span style={{ color: '#60a5fa' }}>{proof.proof.length}</span>
            </div>
            <div style={{ marginTop: '1rem', color: 'rgba(255,255,255,0.8)' }}>
              The proof is cryptographically valid onchain! 🎉
            </div>
          </div>
        );
      } else {
        setOnChainVerificationStatus('failed');
        setProofVerificationInfo(`Merkle Proof Verification FAILED!\n\nThe proof did not match the committed Merkle root.\n\nDescriptor Root: ${descriptorRoot}\nYour Proof Root: ${preview?.root}\n\nThis could mean:\n- The proof is for a different descriptor\n- The value was modified\n- The path is incorrect\n- The proof is invalid`);
      }
      
    } catch (error) {
      console.error('Onchain verification failed:', error);
      setOnChainVerificationStatus('failed');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide helpful error messages
      if (errorMessage.includes('returned no data')) {
        setProofVerificationInfo(`Contract Call Failed\n\nThe contract at ${deployedTokenAddress} returned no data.\n\nPossible causes:\n- The address is not a valid AssetToken contract\n- The contract doesn't implement IFixDescriptor\n- The network is incorrect\n\nPlease ensure you deployed the token using the "Quick Deploy Token" button.`);
      } else if (errorMessage.includes('Descriptor not initialized')) {
        setProofVerificationInfo(`Descriptor Not Initialized\n\nThe token has not been set up with a FIX descriptor yet.`);
      } else {
        setProofVerificationInfo(`Merkle proof verification error:\n\n${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Toggle tree node expansion
  function toggleNode(path: number[]) {
    const pathKey = JSON.stringify(path);
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pathKey)) {
        newSet.delete(pathKey);
      } else {
        newSet.add(pathKey);
      }
      return newSet;
    });
  }

  // Update tree data when expanded nodes change
  function updateTreeExpansion(node: TreeNodeData): TreeNodeData {
    const pathKey = node.path ? JSON.stringify(node.path) : '';
    return {
      ...node,
      isExpanded: pathKey ? expandedNodes.has(pathKey) : node.isExpanded,
      children: node.children?.map(child => updateTreeExpansion(child))
    };
  }

  // No need to build tree client-side anymore - we get it from the API with all real hashes!

  // Highlight proof path in Merkle tree
  function highlightProofPath(node: MerkleNodeData | null, selectedPath: number[]): MerkleNodeData | null {
    if (!node) return null;

    const isSelected = node.path && JSON.stringify(node.path) === JSON.stringify(selectedPath);
    
    const leftHighlighted = node.left ? highlightProofPath(node.left, selectedPath) : undefined;
    const rightHighlighted = node.right ? highlightProofPath(node.right, selectedPath) : undefined;
    
    return {
      ...node,
      isHighlighted: isSelected || (node.left && highlightHasSelected(node.left, selectedPath)) || 
                                    (node.right && highlightHasSelected(node.right, selectedPath)),
      left: leftHighlighted || undefined,
      right: rightHighlighted || undefined
    };
  }

  function highlightHasSelected(node: MerkleNodeData | undefined, selectedPath: number[]): boolean {
    if (!node) return false;
    if (node.path && JSON.stringify(node.path) === JSON.stringify(selectedPath)) return true;
    return highlightHasSelected(node.left, selectedPath) || highlightHasSelected(node.right, selectedPath);
  }

  // Enrich merkle tree with tag and value information from tree data
  function enrichMerkleTreeWithTagInfo(merkleNode: MerkleNodeData | null, treeData: TreeNodeData | null): MerkleNodeData | null {
    if (!merkleNode || !treeData) return merkleNode;

    // If this is a leaf node with a path, find the corresponding field in tree data
    if (merkleNode.type === 'leaf' && merkleNode.path) {
      const field = findFieldByPath(treeData, merkleNode.path);
      if (field && field.type === 'scalar') {
        return {
          ...merkleNode,
          tag: field.tag,
          value: field.value,
          name: field.name
        };
      }
    }

    // Recursively process children
    const enrichedLeft = merkleNode.left ? enrichMerkleTreeWithTagInfo(merkleNode.left, treeData) : undefined;
    const enrichedRight = merkleNode.right ? enrichMerkleTreeWithTagInfo(merkleNode.right, treeData) : undefined;

    return {
      ...merkleNode,
      left: enrichedLeft ?? undefined,
      right: enrichedRight ?? undefined
    };
  }

  // Helper function to find a field by path in tree data
  function findFieldByPath(node: TreeNodeData, targetPath: number[]): TreeNodeData | null {
    if (node.path && JSON.stringify(node.path) === JSON.stringify(targetPath)) {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = findFieldByPath(child, targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  const fixFields = preview?.parsedFields || [];
  const displayTreeData = treeData ? updateTreeExpansion(treeData) : null;

  const ParsedFieldRow = ({ field, depth, isLast }: { field: ParsedFieldNode; depth: number; isLast: boolean }) => {
    if (field.type === 'entry') {
      return (
        <div
          style={{
            padding: '0.5rem 1rem',
            borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
            fontSize: '0.8rem',
            color: 'rgba(255,255,255,0.6)'
          }}
        >
          <div style={{ marginLeft: depth * 16 }}>{field.name}</div>
          {field.children?.map((child, idx) => (
            <ParsedFieldRow key={idx} field={child} depth={depth + 1} isLast={idx === field.children!.length - 1} />
          ))}
        </div>
      );
    }

    if (field.type === 'group') {
      return (
        <div
          style={{
            padding: '0.5rem 1rem',
            borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
            fontSize: '0.85rem'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: depth * 16 }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.9)' }}>
                {field.tag}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{field.name}</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>{field.value}</span>
          </div>
          {field.children?.map((child, idx) => (
            <ParsedFieldRow key={idx} field={child} depth={depth + 1} isLast={idx === field.children!.length - 1} />
          ))}
        </div>
      );
    }

    return (
      <div
        style={{
          padding: '0.5rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.875rem'
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: depth * 16 }}>
          <span style={{ fontWeight: '500', fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.9)' }}>
            {field.tag}
          </span>
          {field.name && (
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>
              {field.name}
            </span>
          )}
        </div>
        <div style={{ flex: 1, color: 'rgba(255,255,255,0.6)', fontFamily: 'ui-monospace, monospace', textAlign: 'right', fontSize: '0.8rem' }}>
          {field.value}
        </div>
      </div>
    );
  };

  // Get Merkle tree from API (with all real keccak256 hashes), enrich with tag info, and highlight selected path
  const baseMerkleTree = preview?.merkleTree || null;
  const enrichedMerkleTree = enrichMerkleTreeWithTagInfo(baseMerkleTree, displayTreeData);
  const selectedPath = pathInput ? (() => {
    try {
      return JSON.parse(pathInput);
    } catch {
      return null;
    }
  })() : null;
  const highlightedMerkleTree = enrichedMerkleTree && selectedPath ? highlightProofPath(enrichedMerkleTree, selectedPath) : enrichedMerkleTree;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ffffff' }}>
      <Navigation currentPage="explorer" />
      
      {/* Background Verification Notification */}
      {verificationNotification?.show && (
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          zIndex: 1000,
          maxWidth: '400px',
          padding: '1rem 1.5rem',
          background: verificationNotification.type === 'success' 
            ? 'rgba(34, 197, 94, 0.95)' 
            : verificationNotification.type === 'warning' || verificationNotification.type === 'error'
            ? 'rgba(251, 191, 36, 0.95)'
            : 'rgba(59, 130, 246, 0.95)',
          border: `1px solid ${
            verificationNotification.type === 'success' 
              ? 'rgba(34, 197, 94, 1)' 
              : verificationNotification.type === 'warning' || verificationNotification.type === 'error'
              ? 'rgba(251, 191, 36, 1)'
              : 'rgba(59, 130, 246, 1)'
          }`,
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          color: '#ffffff',
          fontSize: '0.875rem',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          transition: 'opacity 0.3s ease-out'
        }}>
          <span>{verificationNotification.message}</span>
          <button
            onClick={() => setVerificationNotification(null)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      
      {/* Introduction Section */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(2rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem)' }}>
        <section ref={introRef} style={{ marginBottom: '4rem' }}>
          <div style={{
            padding: '2rem clamp(1.5rem, 4vw, 2.5rem)',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '12px'
          }}>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem', marginBottom: '1rem' }}>
              <h1 style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                fontWeight: '600',
                margin: 0,
                color: 'rgba(255,255,255,0.95)',
                letterSpacing: '-0.02em'
              }}>
                FIX Descriptor Explorer
              </h1>
            </div>
            <p style={{
              fontSize: 'clamp(1rem, 2.5vw, 1.125rem)',
              lineHeight: '1.7',
              color: 'rgba(255,255,255,0.75)',
              marginBottom: '1.5rem'
            }}>
              This interactive tool demonstrates how <Tooltip content="Financial Information eXchange - a standard messaging protocol used by the financial industry for real-time electronic communication">FIX</Tooltip> descriptors are transformed into verifiable on-chain commitments. Follow along as we parse a FIX message, encode it to <Tooltip content="Simple Binary Encoding - a high-performance binary format used in financial systems for deterministic encoding">SBE</Tooltip>, generate a <Tooltip content="A cryptographic tree structure that allows you to prove specific data is part of a larger dataset without revealing the entire dataset">Merkle tree</Tooltip>, and deploy it to the blockchain.
            </p>
            
            <LearnMore title="What is this tool for?">
              <p style={{ marginBottom: '1rem' }}>
                <strong>The Challenge:</strong> Traditional finance systems speak FIX, while blockchain tokens use custom contract fields. This creates integration headaches and prevents seamless cross-platform settlement.
              </p>
              <p style={{ marginBottom: '1rem' }}>
                <strong>The Solution:</strong> Embed standardized FIX descriptors directly in token contracts. This explorer shows you exactly how that works, step by step.
              </p>
              <p>
                <strong>What you&apos;ll see:</strong> Input a FIX message → Parse and canonicalize → Encode to SBE → Generate Merkle root → Deploy to blockchain → Verify proofs → Retrieve data. Each step is explained as you go.
              </p>
            </LearnMore>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginTop: '1.5rem'
            }}>
              <div style={{
                padding: '1rem',
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.25rem' }}>
                  Gasless Deployment
                </div>
                <div style={{ fontSize: '1rem', fontWeight: '500', color: 'rgba(255,255,255,0.9)' }}>
                  No Wallet Required
                </div>
              </div>
              <button
                onClick={() => scrollToSection(inputRef)}
                style={{
                  padding: '1rem',
                  background: 'rgba(59, 130, 246, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  width: '100%',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: '0.875rem', color: 'rgba(96, 165, 250, 0.8)', marginBottom: '0.25rem' }}>
                  Interactive
                </div>
                <div style={{ fontSize: '1rem', fontWeight: '500', color: 'rgba(255,255,255,0.95)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Get Started
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </section>
      </div>
      
      {/* Process Flow */}
      <div 
        ref={progressIndicatorRef}
        style={{ 
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          background: isSticky ? 'rgba(10, 10, 10, 0.98)' : '#0a0a0a',
          backdropFilter: isSticky ? 'blur(8px)' : 'none',
          padding: '1rem 0',
          position: isSticky ? 'fixed' : 'relative',
          top: isSticky ? 0 : 'auto',
          left: isSticky ? 0 : 'auto',
          right: isSticky ? 0 : 'auto',
          zIndex: isSticky ? 100 : 'auto',
          transition: 'all 0.3s',
          boxShadow: isSticky ? '0 4px 6px -1px rgba(0, 0, 0, 0.5)' : 'none'
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 clamp(1rem, 3vw, 2rem)' }}>
          {/* Phase Labels */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '2rem',
            marginBottom: '0.75rem',
            flexWrap: 'wrap'
          }}>
            {phases.map((phase) => {
              const firstStepIdx = steps.findIndex(s => s.phase === phase.id);
              const lastStepIdx = steps.map(s => s.phase).lastIndexOf(phase.id);
              const isActive = currentStep >= firstStepIdx && currentStep <= lastStepIdx;
              const isCompleted = currentStep > lastStepIdx;
              
              return (
                <div key={phase.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  opacity: isActive || isCompleted ? 1 : 0.4,
                  transition: 'opacity 0.3s'
                }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isCompleted ? 'rgba(34, 197, 94, 0.8)' : isActive ? phase.color : 'rgba(255,255,255,0.2)',
                    transition: 'background 0.3s'
                  }} />
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '500',
                    color: isCompleted ? 'rgba(34, 197, 94, 0.9)' : isActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                    transition: 'color 0.3s',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {phase.label}
                  </span>
                  {isCompleted && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(34, 197, 94, 0.9)" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>

          {/* Steps */}
          <div style={{
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.2) transparent',
            paddingBottom: '0.75rem'
          }}>
            <div
              ref={stepsContainerRef}
              style={{ 
                display: 'flex', 
                justifyContent: 'center',
                alignItems: 'flex-start',
                gap: 'clamp(0.75rem, 2vw, 1rem)',
                position: 'relative',
                minWidth: 'min-content'
              }}
            >
              {phases.map((phase) => {
                const phaseSteps = steps.filter(s => s.phase === phase.id);
                const firstStepIdx = steps.findIndex(s => s.phase === phase.id);
                const isPhaseActive = phaseSteps.some((_, i) => firstStepIdx + i === currentStep);
                const isPhaseCompleted = phaseSteps.every((_, i) => firstStepIdx + i < currentStep);
                
                return (
                  <div key={phase.id} style={{
                    display: 'flex',
                    gap: 'clamp(0.5rem, 1.5vw, 0.75rem)',
                    padding: '0.5rem',
                    borderRadius: '8px',
                    background: isPhaseActive ? `${phase.color.replace('0.6', '0.05')}` :
                                isPhaseCompleted ? 'rgba(34, 197, 94, 0.03)' :
                                'rgba(255,255,255,0.02)',
                    border: `1px solid ${isPhaseActive ? phase.color.replace('0.6', '0.15') :
                            isPhaseCompleted ? 'rgba(34, 197, 94, 0.1)' :
                            'rgba(255,255,255,0.05)'}`,
                    transition: 'all 0.3s'
                  }}>
                    {phaseSteps.map((step, i) => {
                      const idx = firstStepIdx + i;
                      return (
                        <div key={idx} style={{ 
                          flex: '0 0 auto',
                          minWidth: 'clamp(80px, 12vw, 110px)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          position: 'relative',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          margin: '-0.5rem',
                          borderRadius: '8px',
                          transition: 'all 0.2s'
                        }}
                        onClick={() => {
                          const sectionRef = getStepSectionRef(idx);
                          if (sectionRef) {
                            scrollToSection(sectionRef);
                          }
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                          const icon = stepIconRefs.current[idx];
                          if (icon) {
                            icon.style.transform = idx === currentStep ? 'scale(1.15)' : 'scale(1.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          const icon = stepIconRefs.current[idx];
                          if (icon) {
                            icon.style.transform = idx === currentStep ? 'scale(1.1)' : 'scale(1)';
                          }
                        }}
                        >
                          <div style={{
                            position: 'relative',
                            zIndex: 1,
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center'
                          }}>
                            <div 
                              style={{ 
                              width: 'clamp(30px, 7vw, 36px)', 
                              height: 'clamp(30px, 7vw, 36px)', 
                              borderRadius: '8px',
                              border: `2px solid ${idx < currentStep ? 'rgba(34, 197, 94, 0.6)' : idx === currentStep ? 'rgba(59, 130, 246, 0.8)' : 'rgba(255,255,255,0.1)'}`,
                              background: idx < currentStep ? 'rgba(34, 197, 94, 0.1)' : idx === currentStep ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: idx < currentStep ? 'rgba(34, 197, 94, 0.9)' : idx === currentStep ? 'rgba(59, 130, 246, 0.9)' : 'rgba(255,255,255,0.3)',
                              transition: 'all 0.3s',
                              marginBottom: '0.5rem',
                              position: 'relative',
                              transform: idx === currentStep ? 'scale(1.1)' : 'scale(1)'
                            }}
                            ref={(el) => { stepIconRefs.current[idx] = el; }}
                            >
                              {idx < currentStep ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : step.icon}
                            </div>
                            <div style={{ 
                              fontSize: 'clamp(0.65rem, 1.7vw, 0.75rem)',
                              fontWeight: '500',
                              color: idx < currentStep ? 'rgba(34, 197, 94, 0.9)' : idx === currentStep ? 'rgba(59, 130, 246, 0.9)' : 'rgba(255,255,255,0.4)',
                              marginBottom: '0.15rem',
                              transition: 'color 0.3s',
                              textAlign: 'center',
                              whiteSpace: 'nowrap'
                            }}>
                              {step.name}
                            </div>
                            <div style={{ 
                              fontSize: 'clamp(0.55rem, 1.3vw, 0.65rem)', 
                              color: 'rgba(255,255,255,0.4)',
                              fontWeight: '400',
                              textAlign: 'center',
                              whiteSpace: 'nowrap'
                            }}>
                              {step.description}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* How It Works - Expandable */}
          <div style={{ maxWidth: '1400px', margin: '0.5rem auto 0', padding: '0 clamp(1rem, 3vw, 2rem)' }}>
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              style={{
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.15)',
                borderRadius: '6px',
                padding: '0.4rem 0.75rem',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                cursor: 'pointer',
                color: 'rgba(59, 130, 246, 0.8)',
                fontSize: '0.75rem',
                fontWeight: '500',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.05)';
              }}
            >
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                style={{
                  transition: 'transform 0.2s',
                  transform: showHowItWorks ? 'rotate(180deg)' : 'rotate(0deg)'
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {showHowItWorks ? 'Hide' : 'Show'} How Each Step Works
            </button>
            
            {showHowItWorks && (
              <div style={{
                marginTop: '1rem',
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                animation: 'slideDown 0.3s ease-out'
              }}>
                <style dangerouslySetInnerHTML={{ __html: `
                  @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                `}} />
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', 
                  gap: 'clamp(1.5rem, 3vw, 2rem)' 
                }}>
                  {[
                    {
                      step: '01',
                      title: 'Parse FIX',
                      description: 'Extract business fields from the FIX message. Session fields are excluded as they\'re not part of the instrument definition.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                      )
                    },
                    {
                      step: '02',
                      title: 'Canonicalize',
                      description: 'Build a hierarchical tree structure with sorted keys, ensuring deterministic ordering.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 2v20" />
                          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                      )
                    },
                    {
                      step: '03',
                      title: 'SBE Encode',
                      description: 'Convert to Simple Binary Encoding using schema for compact, deterministic, high-performance storage.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <line x1="9" y1="9" x2="15" y2="9" />
                          <line x1="9" y1="15" x2="15" y2="15" />
                        </svg>
                      )
                    },
                    {
                      step: '04',
                      title: 'Merkle Tree',
                      description: 'Generate a Merkle tree from all fields. The root provides a cryptographic commitment to the entire descriptor.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="12" cy="8" r="2" />
                          <path d="M12 10v4" />
                          <circle cx="8" cy="16" r="2" />
                          <circle cx="16" cy="16" r="2" />
                          <path d="M12 14l-2 2" />
                          <path d="M12 14l2 2" />
                          <path d="M8 18v2" />
                          <path d="M16 18v2" />
                        </svg>
                      )
                    },
                    {
                      step: '05',
                      title: 'Deploy Token',
                      description: 'Deploy an ERC20 or ERC721 token contract with the FIX descriptor and SBE binary data embedded onchain using SSTORE2, creating a self-contained asset.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                          <polyline points="7.5 19.79 7.5 14.6 3 12" />
                          <polyline points="21 12 16.5 14.6 16.5 19.79" />
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      )
                    },
                    {
                      step: '06',
                      title: 'Verify Proofs',
                      description: 'The token contract can verify specific fields using Merkle proofs against its embedded descriptor, without parsing the entire FIX message.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      )
                    },
                    {
                      step: '07',
                      title: 'Retrieve Offchain',
                      description: 'Read the SBE binary data directly from the contract using SSTORE2 and decode it back to the original FIX message for full transparency and auditability.',
                      icon: (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      )
                    }
                  ].map((item, idx) => (
                    <div key={idx}>
                      <div style={{ 
                        marginBottom: '1.5rem',
                        color: 'rgba(255,255,255,0.6)'
                      }}>
                        {item.icon}
                      </div>
                      <div style={{ 
                        fontSize: '0.75rem',
                        color: 'rgba(255,255,255,0.3)',
                        marginBottom: '0.75rem',
                        fontWeight: '500',
                        letterSpacing: '0.1em'
                      }}>
                        {item.step}
                      </div>
                      <h3 style={{ 
                        fontSize: 'clamp(1rem, 2.5vw, 1.125rem)',
                        fontWeight: '500',
                        marginBottom: '0.75rem',
                        color: 'rgba(255,255,255,0.9)'
                      }}>
                        {item.title}
                      </h3>
                      <p style={{ 
                        fontSize: 'clamp(0.85rem, 2vw, 0.9rem)', 
                        color: 'rgba(255,255,255,0.5)', 
                        lineHeight: '1.7' 
                      }}>
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Spacer when sticky */}
      {isSticky && <div style={{ height: '160px' }} />}

      {/* Loading Overlay */}
      {loading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'rgba(20, 20, 20, 0.98)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '12px',
            padding: '2rem 3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              border: '4px solid rgba(255,255,255,0.1)',
              borderTop: '4px solid rgba(59, 130, 246, 0.8)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <div style={{
              fontSize: '1.1rem',
              fontWeight: '500',
              color: 'rgba(255,255,255,0.9)'
            }}>
              {loadingMessage || 'Processing...'}
            </div>
          </div>
          <style jsx>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Main Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(2rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem)' }}>

        {/* Input Section */}
        <section ref={inputRef} style={{ marginBottom: '4rem' }}>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ 
              fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', 
              fontWeight: '500',
              marginBottom: '0.5rem',
              letterSpacing: '-0.01em'
            }}>
              1. Input Schema & Message
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)' }}>
              Start by entering an Orchestra XML schema, then build or paste a FIX message
            </p>
          </div>

          {/* Schema Input */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: '0.875rem',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '0.75rem',
              fontWeight: '500',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Orchestra XML Schema
            </div>

            <LearnMore title="Understanding Orchestra XML">
              <p style={{ marginBottom: '1rem' }}>
                <strong>What is Orchestra?</strong><br/>
                Orchestra is the FIX Trading Community&apos;s modern standard for defining FIX message structures. It uses XML to describe message types, fields, data types, and validation rules in a machine-readable format.
              </p>
              <p style={{ marginBottom: '1rem' }}>
                <strong>Schema Structure:</strong><br/>
                An Orchestra schema contains:<br/>
                • Message definitions with their fields and structure<br/>
                • Data type specifications (strings, integers, enums, etc.)<br/>
                • Field definitions with tags, names, and types<br/>
                • Groups and repeating elements for complex structures<br/>
                This schema is used to validate FIX messages and convert them to binary formats like SBE.
              </p>
              <p>
                <strong>Why Orchestra?</strong><br/>
                Orchestra provides a single source of truth for message structure, enabling automated code generation, validation, and conversion between different encoding formats (tag=value, SBE, JSON, etc.).
              </p>
            </LearnMore>

            <textarea 
              value={schemaInput} 
              onChange={(e) => setSchemaInput(e.target.value)} 
              rows={8} 
              placeholder="Paste Orchestra XML schema here..."
              className="no-scrollbar"
              style={{ 
                width: '100%', 
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: '#ffffff',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                resize: 'vertical',
                lineHeight: '1.6',
                boxSizing: 'border-box'
              }} 
            />
            <button
              onClick={async () => {
                try {
                  const response = await fetch('/ORCHESTRAFIX44.xml');
                  const text = await response.text();
                  setSchemaInput(text);
                  
                  // Scroll to message type section after loading
                  setTimeout(() => {
                    scrollToSection(messageTypeRef);
                  }, 300);
                } catch (error) {
                  console.error('Failed to load Orchestra schema:', error);
                }
              }}
              style={{
                marginTop: '0.75rem',
                background: '#ffffff',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: '6px',
                padding: '0.875rem 2rem',
                fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s',
                minHeight: '44px'
              }}
            >
              Load FIX 4.4 Orchestra Schema
            </button>
          </div>

          {/* Only show subsequent sections if Orchestra XML has been entered */}
          {schemaInput.trim() && (
            <div ref={messageTypeRef}>
              {/* Generated SBE Schema Preview - Full Schema with All Messages */}
              {fullSbeSchema && (
                <CollapsibleSection 
                  title="Generated SBE Schema (All Messages)" 
                  icon={<FaSyncAlt size={18} />}
                  defaultCollapsed={true}
                >
                  <LearnMore title="Understanding SBE Schema">
                    <p style={{ marginBottom: '1rem' }}>
                      <strong>What is SBE?</strong><br/>
                      SBE (Simple Binary Encoding) is a high-performance binary encoding format designed for low-latency financial messaging. It&apos;s significantly more efficient than traditional tag=value FIX encoding.
                    </p>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong>Why Convert to SBE?</strong><br/>
                      • Compact binary format reduces storage costs on blockchain<br/>
                      • Deterministic encoding ensures consistent hashes<br/>
                      • Schema-driven validation prevents malformed data<br/>
                      • Industry-standard format used by major exchanges
                    </p>
                    <p>
                      <strong>Schema Contents:</strong><br/>
                      This generated schema defines the binary structure for all message types in your Orchestra file. It specifies field types, byte offsets, and encoding rules that the encoder uses to convert FIX messages to compact binary format.
                    </p>
                  </LearnMore>

                  <textarea 
                    readOnly 
                    value={fullSbeSchema} 
                    rows={15}
                    className="custom-scrollbar"
                    style={{
                      width: '100%',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(34, 197, 94, 0.2)',
                      background: 'rgba(34, 197, 94, 0.03)',
                      color: 'rgba(34, 197, 94, 0.9)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '0.75rem',
                      lineHeight: '1.5',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                </CollapsibleSection>
              )}

              {/* Message Type Selection */}
              <MessageTypeSelector
                availableMessageTypes={availableMessageTypes}
                selectedMessageType={selectedMessageType}
                onSelect={setSelectedMessageType}
                currentMessageId={currentMessageId}
              />

              {/* Orchestra XML Parser Preview */}
              {orchestraError && (
                <div style={{
                  padding: '1rem',
                  marginBottom: '1.5rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  color: 'rgba(239, 68, 68, 0.9)',
                  fontSize: '0.875rem'
                }}>
                  <strong>Parse Error:</strong> {orchestraError}
                </div>
              )}

              {parsedOrchestra && (
                <ParsedSchemaSection
                  parsedOrchestra={parsedOrchestra}
                  allMessages={allMessages}
                  selectedMessageIndex={selectedMessageIndex}
                  onMessageIndexChange={setSelectedMessageIndex}
                />
              )}

              {/* Message Builder */}
              {parsedOrchestra && (
                <MessageBuilderSection
                  parsedOrchestra={parsedOrchestra}
                  messageBuilderValues={messageBuilderValues as Record<string, string | string[]>}
                  onValuesChange={setMessageBuilderValues}
                  onFixMessageChange={setFixRaw}
                />
              )}

              {/* FIX Message Input */}
              <div style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: '0.875rem',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '0.75rem',
              fontWeight: '500',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              FIX Message
            </div>
            
            {/* Example Selector */}
            <ExampleSelector 
              examples={EXAMPLES}
              onSelectExample={setFixRaw}
            />

            <LearnMore title="Understanding FIX Messages">
              <p style={{ marginBottom: '1rem' }}>
                <strong>What is FIX?</strong><br/>
                FIX (Financial Information eXchange) is the messaging standard that powers modern financial markets. Banks, brokers, exchanges, and asset managers use it to communicate trade details, security information, and market data in real-time.
              </p>
              <p style={{ marginBottom: '1rem' }}>
                <strong>Message Format:</strong><br/>
                FIX messages use a simple tag=value format. Each tag is a number representing a specific field:<br/>
                • Tag 55 = Symbol (e.g., &ldquo;AAPL&rdquo;)<br/>
                • Tag 48 = SecurityID (e.g., a CUSIP or ISIN)<br/>
                • Tag 167 = SecurityType (e.g., &ldquo;TBOND&rdquo; for Treasury Bond)<br/>
                Tags are separated by the | character (representing SOH - Start of Header in the actual protocol).
              </p>
              <p>
                <strong>What gets encoded?</strong><br/>
                Only business/instrument fields are encoded into the on-chain commitment. Session fields (tags 8, 9, 10, 35) are excluded because they&apos;re for message transport, not instrument definition.
              </p>
            </LearnMore>
            <textarea 
              value={fixRaw} 
              onChange={(e) => setFixRaw(e.target.value)} 
              rows={4} 
              placeholder="Enter business fields only (e.g., 55=AAPL|48=US0378331005) or use the builder above..."
              className="custom-scrollbar"
              style={{ 
                width: '100%', 
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: '#ffffff',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                resize: 'vertical',
                lineHeight: '1.6',
                boxSizing: 'border-box'
              }} 
            />
          </div>

          {fixFields.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ 
                fontSize: '0.875rem',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: '1rem',
                fontWeight: '500'
              }}>
                Parsed Fields ({fixFields.length})
              </div>
              <div className="custom-scrollbar" style={{ 
                maxHeight: '200px', 
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.03)'
              }}>
                {fixFields.map((field, idx) => (
                  <ParsedFieldRow key={idx} field={field} depth={0} isLast={idx === fixFields.length - 1} />
                ))}
              </div>
            </div>
          )}

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={doPreview}
                  disabled={!fixRaw || loading}
                  style={{
                    background: fixRaw && !loading ? '#ffffff' : 'rgba(255,255,255,0.1)',
                    color: fixRaw && !loading ? '#0a0a0a' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.875rem 2rem',
                    fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                    fontWeight: '500',
                    cursor: fixRaw && !loading ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s',
                    minHeight: '44px'
                  }}
                >
                  {loading ? 'Processing...' : 'Process'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Results Section */}
        {preview && (
          <>
            <section ref={resultsRef} style={{ 
              marginBottom: '4rem',
              padding: '2rem',
              background: 'rgba(34, 197, 94, 0.03)',
              border: '2px solid rgba(34, 197, 94, 0.2)',
              borderRadius: '12px',
              animation: 'fadeIn 0.5s ease-in'
            }}>
              <style jsx>{`
                @keyframes fadeIn {
                  from { opacity: 0; transform: translateY(10px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
              
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(34, 197, 94, 0.9)" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <h2 style={{ 
                    fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', 
                    fontWeight: '500',
                    letterSpacing: '-0.01em',
                    margin: 0,
                    color: 'rgba(255,255,255,0.95)'
                  }}>
                    2. Processing Complete
                  </h2>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)', marginLeft: '2.25rem' }}>
                  Your FIX message has been parsed, encoded to <Tooltip content="Simple Binary Encoding - a high-performance binary format that's deterministic and used in financial systems">SBE</Tooltip>, and a <Tooltip content="A hash-based tree where each leaf is a field, allowing you to cryptographically prove any field's value">Merkle root</Tooltip> has been generated
                </p>
              </div>

              <LearnMore title="Understanding SBE and Merkle Trees">
                <p style={{ marginBottom: '1rem' }}>
                  <strong>Why SBE?</strong><br/>
                  SBE (Simple Binary Encoding) is a high-performance binary format used in financial systems. It&apos;s <em>deterministic</em> - the same data with the same schema always encodes to the exact same bytes. This is critical for blockchain because we need everyone to agree on the exact commitment.
                </p>
                <p style={{ marginBottom: '1rem' }}>
                  <strong>What&apos;s a Merkle Tree?</strong><br/>
                  Think of it like a receipt system. Each FIX field becomes a &ldquo;leaf&rdquo; in the tree. These leaves are hashed and combined pairwise up to a single &ldquo;root&rdquo; hash. The root is like a fingerprint of all your data - change one field, and the root changes completely.
                </p>
                <p>
                  <strong>Why is this useful?</strong><br/>
                  You can prove any specific field&apos;s value (like &ldquo;this bond has a 4.25% coupon&rdquo;) by showing just that field plus a few hashes (the &ldquo;proof path&rdquo;). You don&apos;t need to reveal all the other fields, and the verifier can check it mathematically against the root stored on-chain.
                </p>
              </LearnMore>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', 
                gap: 'clamp(1rem, 2vw, 1.5rem)',
                marginBottom: '2rem'
              }}>
                <div style={{
                  padding: '1.5rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px'
                }}>
                  <div style={{ 
                    fontSize: '0.8rem',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '0.75rem',
                    fontWeight: '500',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Merkle Root
                  </div>
                  <div style={{ 
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                    wordBreak: 'break-all', 
                    color: 'rgba(255,255,255,0.9)',
                    lineHeight: '1.6'
                  }}>
                    {preview.root}
                  </div>
                </div>

                <div style={{
                  padding: '1.5rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px'
                }}>
                  <div style={{ 
                    fontSize: '0.8rem',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '0.75rem',
                    fontWeight: '500',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Statistics
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Leaves</span>
                      <span style={{ fontWeight: '500', fontSize: '0.875rem' }}>{preview.leavesCount}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Encoded Size</span>
                      <span style={{ fontWeight: '500', fontSize: '0.875rem' }}>
                        {Math.floor((preview.sbeBase64.length * 3) / 4)} bytes
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* View Mode Tabs */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {[
                    { key: 'hex', label: 'Encoded Base64' },
                    { key: 'tree', label: 'Tree View' },
                    { key: 'merkle', label: 'Merkle Tree' }
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setViewMode(key as 'hex' | 'tree' | 'merkle')}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom: viewMode === key ? '2px solid rgba(255,255,255,0.9)' : '2px solid transparent',
                        padding: '0.75rem 1rem',
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        color: viewMode === key ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        marginBottom: '-1px'
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                {viewMode === 'hex' && (
                  <>
                    <div style={{ 
                      fontSize: '0.8rem',
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: '0.75rem',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      SBE Encoded Base64
                    </div>
                    <textarea 
                      readOnly 
                      value={preview.sbeBase64} 
                      rows={6}
                      className="custom-scrollbar"
                      style={{ 
                        width: '100%',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.03)',
                        color: 'rgba(255,255,255,0.7)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                        resize: 'vertical',
                        lineHeight: '1.6',
                        boxSizing: 'border-box'
                      }} 
                    />
                  </>
                )}

                {viewMode === 'tree' && displayTreeData && (
                  <div style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    padding: '1rem',
                    maxHeight: '500px',
                    overflowY: 'auto'
                  }}>
                    <TreeNode 
                      node={displayTreeData} 
                      onToggle={toggleNode}
                      onPathClick={(path) => {
                        setPathInput(JSON.stringify(path));
                        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                      }}
                    />
                  </div>
                )}

                {viewMode === 'merkle' && (
                  <div style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    padding: '2rem',
                    overflowX: 'auto'
                  }}>
                    {highlightedMerkleTree ? (
                      <>
                        <div style={{ 
                          marginBottom: '2rem',
                          padding: '1rem',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          color: 'rgba(255,255,255,0.7)',
                          lineHeight: '1.6'
                        }}>
                          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Merkle Tree Visualization</strong><br/>
                          Each leaf represents a field in the FIX descriptor. Click a leaf to select its path for proof generation.
                          {selectedPath && (
                            <>
                              <br/><br/>
                              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Selected Path:</strong>{' '}
                              <code style={{ 
                                fontFamily: 'ui-monospace, monospace',
                                background: 'rgba(255,255,255,0.1)',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '3px'
                              }}>
                                {JSON.stringify(selectedPath)}
                              </code>
                              <br/>
                              Highlighted nodes show the proof path from the selected leaf to the root.
                            </>
                          )}
                        </div>
                        <div style={{ 
                          minHeight: '300px',
                          paddingBottom: '2rem'
                        }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'center',
                              width: 'max-content',
                              minWidth: '100%',
                              margin: '0 auto',
                              overflow: 'visible'
                            }}
                          >
                            <MerkleTreeNode 
                              node={highlightedMerkleTree}
                              onLeafClick={(path) => {
                                setPathInput(JSON.stringify(path));
                              }}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ 
                        textAlign: 'center', 
                        color: 'rgba(255,255,255,0.5)',
                        padding: '2rem'
                      }}>
                        No Merkle tree data available
                      </div>
        )}
      </div>
                )}
              </div>

      <div ref={deployRef}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ 
                    fontSize: 'clamp(1.1rem, 2.5vw, 1.25rem)',
                    fontWeight: '500',
                    marginBottom: '0.5rem',
                    letterSpacing: '-0.01em',
                    color: 'rgba(255,255,255,0.95)'
                  }}>
                    3. Deploy to Blockchain
                  </h3>
                  <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)' }}>
                    Store your <Tooltip content="The cryptographic hash that represents your entire FIX descriptor">Merkle root</Tooltip> and <Tooltip content="The SBE encoded binary data of your FIX message">encoded data</Tooltip> on the <Tooltip content="Sepolia is a test network - no real money is used. Get free testnet ETH from faucets.">Sepolia testnet</Tooltip>
                  </p>
                </div>

                <LearnMore title="About Blockchain Deployment">
                  <p style={{ marginBottom: '1rem' }}>
                    <strong>What happens when you deploy?</strong><br/>
                    Deployment creates a new ERC20 token contract on the blockchain with your FIX descriptor embedded. The SBE encoded data is stored using SSTORE2 (an efficient storage technique), and the Merkle root is saved in the contract.
                  </p>
                  <p style={{ marginBottom: '1rem' }}>
                    <strong>Is this free?</strong><br/>
                    Yes! This is a gasless deployment - no wallet or crypto required. Our backend handles the transaction signing and pays all gas fees. Just fill in the token details and click deploy.
                  </p>
                  <p>
                    <strong>What can I do with a deployed token?</strong><br/>
                    Once deployed, anyone can read the encoded data from the contract, verify Merkle proofs against the root, and decode the full FIX message. This demonstrates how real tokenized securities could work - with verifiable, standardized descriptors.
                  </p>
                </LearnMore>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => setShowTokenDeploy(!showTokenDeploy)}
                    style={{
                      background: showTokenDeploy ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '6px',
                      padding: '0.875rem 1.5rem',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = showTokenDeploy ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)';
                    }}
                  >
                    {showTokenDeploy ? '− Hide Deployment Form' : 'Deploy to Testnet'}
                  </button>
          </div>
                {txInfo && (
                  <div style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                    borderRadius: '6px',
                    fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                    color: 'rgba(34, 197, 94, 0.9)',
                    wordBreak: 'break-all',
                    fontFamily: 'ui-monospace, monospace',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {txInfo}
                  </div>
        )}

                {/* Token Deployment Form */}
                {showTokenDeploy && (
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1.5rem',
                    background: 'rgba(59, 130, 246, 0.05)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: '8px'
                  }}>
                    <h3 style={{ 
                      fontSize: '1.1rem', 
                      fontWeight: '600', 
                      marginBottom: '1rem',
                      color: '#60a5fa'
                    }}>
                      Deploy ERC20 Token with Descriptor
                    </h3>
                    <p style={{
                      fontSize: '0.875rem',
                      color: 'rgba(255,255,255,0.6)',
                      marginBottom: '1.5rem'
                    }}>
                      Deploy a new ERC20 token with the FIX descriptor embedded in one transaction using AssetTokenFactory.
                    </p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontSize: '0.875rem', 
                          marginBottom: '0.5rem',
                          color: 'rgba(255,255,255,0.8)'
                        }}>
                          Token Name
                        </label>
                        <input
                          type="text"
                          value={tokenName}
                          onChange={(e) => setTokenName(e.target.value)}
                          placeholder="US Treasury Bond Token"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            color: '#ffffff',
                            fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                            boxSizing: 'border-box',
                            minHeight: '44px'
                          }}
                        />
                      </div>
                      
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ 
                            display: 'block', 
                            fontSize: '0.875rem', 
                            marginBottom: '0.5rem',
                            color: 'rgba(255,255,255,0.8)'
                          }}>
                            Symbol
                          </label>
                          <input
                            type="text"
                            value={tokenSymbol}
                            onChange={(e) => setTokenSymbol(e.target.value)}
                            placeholder="USTB"
                            style={{
                              width: '100%',
                              padding: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#ffffff',
                              fontSize: '0.875rem'
                            }}
                          />
                        </div>
                        
                        <div style={{ flex: 1 }}>
                          <label style={{ 
                            display: 'block', 
                            fontSize: '0.875rem', 
                            marginBottom: '0.5rem',
                            color: 'rgba(255,255,255,0.8)'
                          }}>
                            Initial Supply
                          </label>
                          <input
                            type="text"
                            value={tokenSupply}
                            onChange={(e) => setTokenSupply(e.target.value)}
                            placeholder="1000000"
                            style={{
                              width: '100%',
                              padding: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#ffffff',
                              fontSize: '0.875rem'
                            }}
                          />
                        </div>
                      </div>

                      <button
                        onClick={deployWithFactory}
                        disabled={!tokenName || !tokenSymbol || !tokenSupply || loading}
                        style={{
                          background: tokenName && tokenSymbol && tokenSupply && !loading
                            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.3) 100%)'
                            : 'rgba(255,255,255,0.05)',
                          color: tokenName && tokenSymbol && tokenSupply && !loading ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '6px',
                          padding: '1rem',
                          fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                          fontWeight: '600',
                          cursor: tokenName && tokenSymbol && tokenSupply && !loading ? 'pointer' : 'not-allowed',
                          transition: 'all 0.2s',
                          opacity: tokenName && tokenSymbol && tokenSupply && !loading ? 1 : 0.5,
                          minHeight: '44px',
                          width: '100%'
                        }}
                      >
                        {loading ? 'Deploying...' : 'Deploy Token with Descriptor'}
                      </button>
                    </div>
                  </div>
                )}
      </div>
            </section>

            {/* Proof Section */}
            <section ref={proofRef} style={{ marginBottom: '4rem' }}>
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{
                  fontSize: 'clamp(1.25rem, 3vw, 1.5rem)',
                  fontWeight: '500',
                  marginBottom: '0.5rem',
                  letterSpacing: '-0.01em'
                }}>
                  4. Generate Merkle Proof
                </h2>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)' }}>
                  Select a FIX field and create a cryptographic proof that can verify the field&apos;s value <Tooltip content="The proof allows efficient onchain verification of a specific field without decoding the entire SBE descriptor">onchain with minimal gas</Tooltip>
                </p>
              </div>

              <LearnMore title="How Merkle Proofs Work">
                <p style={{ marginBottom: '1rem' }}>
                  <strong>What&apos;s a Merkle Proof?</strong><br/>
                  A Merkle proof lets you verify that a specific field exists in the onchain descriptor with a specific value, without needing to download and decode the entire SBE binary data. This makes verification extremely gas-efficient.
                </p>
                <p style={{ marginBottom: '1rem' }}>
                  <strong>How it works:</strong><br/>
                  The full FIX descriptor is stored onchain as SBE binary data, along with a Merkle root hash. To verify a field:
                  <br/>• You provide the field value and its path in the data structure
                  <br/>• You provide a &ldquo;proof&rdquo; - a small set of sibling hashes from the Merkle tree
                  <br/>• The smart contract recomputes the Merkle root from this data
                  <br/>• If the recomputed root matches the stored root, the field is verified
                </p>
                <p style={{ marginBottom: '1rem' }}>
                  <strong>Why is this useful?</strong><br/>
                  Instead of decoding the entire descriptor onchain (expensive), you can verify individual fields efficiently. This enables use cases like &ldquo;prove this bond has a 4.25% coupon rate&rdquo; or &ldquo;verify the maturity date&rdquo; in a single transaction with minimal gas cost.
                </p>
                <p>
                  <strong>What&apos;s a &ldquo;path&rdquo;?</strong><br/>
                  The path is how we navigate the data structure to find a field. For simple fields, the path is just the tag number: [15] means &ldquo;FIX tag 15.&rdquo; For nested group fields, paths include the group tag, entry index, and field tag.
                </p>
              </LearnMore>

              <div style={{
                padding: '1rem',
                background: 'rgba(168, 85, 247, 0.05)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                fontSize: '0.9rem',
                color: 'rgba(255,255,255,0.75)',
                lineHeight: '1.6'
              }}>
                <strong style={{ color: 'rgba(168, 85, 247, 0.9)' }}>💡 How it works:</strong> Select a field below to generate a Merkle proof. For example, selecting &ldquo;Tag 223 (CouponRate) = 4.250&rdquo; creates a compact proof that can efficiently verify this field&apos;s value onchain without decoding the entire descriptor.
              </div>

              {preview.paths && preview.paths.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '1rem',
                    fontWeight: '500',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Select a Field to Prove
                  </div>
                <div style={{
                  maxHeight: '300px',
                  overflowY: 'auto',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '0.5rem'
                }}>
                  {(() => {
                    const normalizePath = (rawPath: number[]) => {
                      if (rawPath.length < 3) return rawPath.map((value) => Number(value));
                      const normalized = rawPath.map((value) => Number(value));
                      for (let i = 1; i < normalized.length; i += 2) {
                        normalized[i] = normalized[i] + 1;
                      }
                      return normalized;
                    };

                    const findFieldByPath = (node: TreeNodeData, targetPath: number[]): TreeNodeData | null => {
                      if (node.path && JSON.stringify(node.path) === JSON.stringify(targetPath)) {
                        return node;
                      }
                      if (node.children) {
                        for (const child of node.children) {
                          const found = findFieldByPath(child, targetPath);
                          if (found) return found;
                        }
                      }
                      return null;
                    };

                    const scalarPaths = preview.paths.filter((p) => p.length === 1);
                    const groupPaths = preview.paths.filter((p) => p.length > 1);
                    const groups = new Map<number, Map<number, Array<{ path: number[]; tag?: string; value?: string; name?: string }>>>();

                    for (const rawPath of groupPaths) {
                      const normalizedPath = normalizePath(rawPath);
                      const groupTag = normalizedPath[0];
                      const entryIndex = normalizedPath[1];
                      const leafTag = normalizedPath[normalizedPath.length - 1];
                      let tag: string | undefined;
                      let value: string | undefined;
                      let name: string | undefined;
                      if (displayTreeData) {
                        const field = findFieldByPath(displayTreeData, normalizedPath);
                        if (field?.type === 'scalar') {
                          tag = field.tag;
                          value = field.value;
                          name = field.name;
                        }
                      }
                      if (!tag && Number.isFinite(leafTag)) {
                        tag = String(leafTag);
                      }
                      if (!groups.has(groupTag)) {
                        groups.set(groupTag, new Map());
                      }
                      const entryMap = groups.get(groupTag)!;
                      if (!entryMap.has(entryIndex)) {
                        entryMap.set(entryIndex, []);
                      }
                      entryMap.get(entryIndex)!.push({ path: rawPath, tag, value, name });
                    }

                    const renderPathButton = (item: { path: number[]; tag?: string; value?: string; name?: string }) => (
                      <button
                        key={JSON.stringify(item.path)}
                        onClick={() => setPathInput(JSON.stringify(item.path))}
                        style={{
                          display: 'flex',
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.6rem 0.75rem',
                          background: pathInput === JSON.stringify(item.path) ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          color: 'rgba(255,255,255,0.75)',
                          transition: 'all 0.2s',
                          alignItems: 'center',
                          gap: '0.75rem'
                        }}
                      >
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontWeight: '600',
                              color: 'rgba(96, 165, 250, 0.9)',
                              fontSize: '0.9rem'
                            }}>
                              {item.tag ? (item.name ? `${item.name} (${item.tag})` : `Tag ${item.tag}`) : JSON.stringify(item.path)}
                            </span>
                          </div>
                          {item.tag && item.value !== undefined && (
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>
                              {item.tag} = {item.value}
                            </div>
                          )}
                        </div>
                        <div style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: '0.7rem',
                          color: 'rgba(255,255,255,0.3)'
                        }}>
                          [{item.path.join(',')}]
                        </div>
                      </button>
                    );

                    return (
                      <div>
                        {scalarPaths.map((path) => {
                          let tag: string | undefined;
                          let value: string | undefined;
                          let name: string | undefined;
                          if (displayTreeData?.children) {
                            const tagNum = String(path[0]);
                            const parsedField = displayTreeData.children.find(
                              (child) => child.type === 'scalar' && child.tag === tagNum,
                            );
                            if (parsedField) {
                              tag = parsedField.tag;
                              value = parsedField.value;
                              name = parsedField.name;
                            }
                          }
                          if (!tag && path.length === 1) {
                            tag = String(path[0]);
                          }
                          return renderPathButton({ path, tag, value, name });
                        })}

                        {Array.from(groups.entries()).map(([groupTag, entries]) => {
                          const groupName = displayTreeData?.children?.find(
                            (child) => child.type === 'group' && child.tag === String(groupTag),
                          )?.name;
                          return (
                          <div key={groupTag} style={{ marginTop: '0.75rem' }}>
                            <div style={{
                              padding: '0.5rem 0.75rem',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              color: 'rgba(255,255,255,0.85)',
                              background: 'rgba(255,255,255,0.04)',
                              borderRadius: '6px'
                            }}>
                              Group {groupTag}{groupName ? ` · ${groupName}` : ''}
                            </div>
                            {Array.from(entries.entries()).map(([entryIndex, items]) => (
                              <div key={entryIndex} style={{ marginLeft: '0.75rem', marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.25rem' }}>
                                  Entry {entryIndex}
                                </div>
                                {items.map(renderPathButton)}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                      </div>
                    );
                  })()}
                </div>
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '0.75rem',
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>Selected Path</span>
                  {pathInput && displayTreeData && (() => {
                    try {
                      const parsedPath = JSON.parse(pathInput);
                      const findFieldByPath = (node: TreeNodeData, targetPath: number[]): TreeNodeData | null => {
                        if (node.path && JSON.stringify(node.path) === JSON.stringify(targetPath)) {
                          return node;
                        }
                        if (node.children) {
                          for (const child of node.children) {
                            const found = findFieldByPath(child, targetPath);
                            if (found) return found;
                          }
                        }
                        return null;
                      };
                      const field = findFieldByPath(displayTreeData, parsedPath);
                      if (field && field.type === 'scalar') {
                        return (
                          <span style={{
                            fontSize: '0.75rem',
                            color: 'rgba(96, 165, 250, 0.9)',
                            fontWeight: '500',
                            textTransform: 'none'
                          }}>
                            Tag {field.tag}{field.name ? ` (${field.name})` : ''} = {field.value}
                          </span>
                        );
                      }
                    } catch {
                      // Invalid JSON, ignore
                    }
                    return null;
                  })()}
                </div>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder='Select a field above or enter path like [15]'
                  style={{
                    width: '100%',
                    padding: '0.875rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.03)',
                    color: '#ffffff',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                    boxSizing: 'border-box',
                    minHeight: '44px'
                  }}
                />
              </div>

              <button
                onClick={doProof}
                disabled={!pathInput || loading}
                style={{
                  background: pathInput && !loading ? '#ffffff' : 'rgba(255,255,255,0.1)',
                  color: pathInput && !loading ? '#0a0a0a' : 'rgba(255,255,255,0.3)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.875rem 2rem',
                  fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                  fontWeight: '500',
                  cursor: pathInput && !loading ? 'pointer' : 'not-allowed',
                  marginBottom: '2rem',
                  minHeight: '44px',
                  transition: 'all 0.2s'
                }}
              >
                {loading ? 'Generating...' : pathInput ? 'Generate Proof' : 'Select a Field First'}
              </button>

        {proof && (
                <div
                  ref={proofResultsRef}
                  style={{
                  display: 'grid',
                  gap: '1.5rem',
                  padding: '2rem',
                  borderRadius: '12px',
                  border: onChainVerificationStatus === 'success' ? '2px solid rgba(34, 197, 94, 0.4)' :
                          onChainVerificationStatus === 'failed' ? '2px solid rgba(239, 68, 68, 0.4)' :
                          onChainVerificationStatus === 'pending' ? '2px solid rgba(59, 130, 246, 0.4)' :
                          '1px solid rgba(255,255,255,0.1)',
                  background: onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.05)' :
                              onChainVerificationStatus === 'failed' ? 'rgba(239, 68, 68, 0.05)' :
                              onChainVerificationStatus === 'pending' ? 'rgba(59, 130, 246, 0.05)' :
                              'transparent',
                  transition: 'all 0.3s ease'
                }}>
                  {/* Proof Summary */}
                  {pathInput && displayTreeData && (() => {
                    try {
                      const parsedPath = JSON.parse(pathInput);
                      const findFieldByPath = (node: TreeNodeData, targetPath: number[]): TreeNodeData | null => {
                        if (!node.path) return null;
                        if (JSON.stringify(node.path) === JSON.stringify(targetPath)) {
                          return node;
                        }
                        if (node.children) {
                          for (const child of node.children) {
                            const found = findFieldByPath(child, targetPath);
                            if (found) return found;
                          }
                        }
                        return null;
                      };
                      const field = findFieldByPath(displayTreeData, parsedPath);
                      if (field && field.type === 'scalar') {
                        return (
                          <div style={{
                            padding: '1.5rem',
                            borderRadius: '8px',
                            background: 'rgba(168, 85, 247, 0.1)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            marginBottom: '1rem'
                          }}>
                            <div style={{
                              fontSize: '0.75rem',
                              color: 'rgba(255,255,255,0.5)',
                              marginBottom: '0.75rem',
                              fontWeight: '500',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em'
                            }}>
                              Proof Generated For
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontFamily: 'ui-monospace, monospace',
                                  fontWeight: '600',
                                  color: 'rgba(168, 85, 247, 0.9)',
                                  fontSize: '1.1rem'
                                }}>
                                  Tag {field.tag}
                                </span>
                                {field.name && (
                                  <span style={{
                                    color: 'rgba(255,255,255,0.6)',
                                    fontSize: '0.9rem'
                                  }}>
                                    ({field.name})
                                  </span>
                                )}
                                <span style={{
                                  color: 'rgba(255,255,255,0.5)',
                                  fontSize: '0.9rem'
                                }}>
                                  =
                                </span>
                                <span style={{
                                  fontFamily: 'ui-monospace, monospace',
                                  fontSize: '1rem',
                                  color: 'rgba(255,255,255,0.9)',
                                  fontWeight: '500'
                                }}>
                                  {field.value}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    } catch {
                      // Invalid JSON, ignore
                    }
                    return null;
                  })()}

                  {/* Verification Status Badge */}
                  {onChainVerificationStatus && (
                    <div style={{
                      padding: '1rem 1.5rem',
                      borderRadius: '8px',
                      marginBottom: '1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      background: onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.15)' :
                                  onChainVerificationStatus === 'failed' ? 'rgba(239, 68, 68, 0.15)' :
                                  'rgba(59, 130, 246, 0.15)',
                      border: onChainVerificationStatus === 'success' ? '1px solid rgba(34, 197, 94, 0.3)' :
                              onChainVerificationStatus === 'failed' ? '1px solid rgba(239, 68, 68, 0.3)' :
                              '1px solid rgba(59, 130, 246, 0.3)',
                    }}>
                      <div style={{ fontSize: '1.5rem' }}>
                        {onChainVerificationStatus === 'success' ? '●' :
                         onChainVerificationStatus === 'failed' ? '●' :
                         '●'}
                      </div>
                      <div>
                        <div style={{
                          fontSize: '0.9rem',
                          fontWeight: '600',
                          color: onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.95)' :
                                 onChainVerificationStatus === 'failed' ? 'rgba(239, 68, 68, 0.95)' :
                                 'rgba(59, 130, 246, 0.95)',
                          marginBottom: '0.25rem'
                        }}>
                          {onChainVerificationStatus === 'success' ? 'Onchain Verification Successful' :
                           onChainVerificationStatus === 'failed' ? 'Onchain Verification Failed' :
                           'Verifying Onchain...'}
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          color: 'rgba(255,255,255,0.6)'
                        }}>
                          {onChainVerificationStatus === 'success' ? 'This proof is cryptographically valid on the blockchain' :
                           onChainVerificationStatus === 'failed' ? 'The proof could not be verified against the onchain descriptor' :
                           'Checking proof against deployed contract...'}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <div style={{ 
                      fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: '0.75rem',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Field Path (hex)
      </div>
                    <textarea 
                      readOnly 
                      value={proof.pathCBORHex} 
                      rows={2} 
                      style={{ 
                        width: '100%',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.03)',
                        color: 'rgba(255,255,255,0.7)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                        resize: 'vertical',
                        lineHeight: '1.6',
                        boxSizing: 'border-box',
                        wordBreak: 'break-all'
                      }} 
                    />
    </div>

                  <div>
                    <div style={{ 
                      fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: '0.75rem',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Value (hex)
                    </div>
                    <textarea 
                      readOnly 
                      value={proof.valueHex} 
                      rows={2} 
                      style={{ 
                        width: '100%',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.03)',
                        color: 'rgba(255,255,255,0.7)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                        resize: 'vertical',
                        lineHeight: '1.6',
                        boxSizing: 'border-box',
                        wordBreak: 'break-all'
                      }} 
                    />
                  </div>

                  <div>
                    <div style={{ 
                      fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: '0.75rem',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Proof (sibling hashes)
                    </div>
                    <textarea 
                      readOnly 
                      value={JSON.stringify(proof.proof, null, 2)} 
                      rows={6} 
                      style={{ 
                        width: '100%',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.03)',
                        color: 'rgba(255,255,255,0.7)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                        resize: 'vertical',
                        lineHeight: '1.6',
                        boxSizing: 'border-box',
                        wordBreak: 'break-all'
                      }} 
                    />
                  </div>

                  <div>
                    <div style={{ 
                      fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: '0.75rem',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Directions
                    </div>
                    <div style={{
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.03)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                      color: 'rgba(255,255,255,0.7)',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word'
                    }}>
                      {JSON.stringify(proof.directions)}
                      <div style={{ 
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)', 
                        color: 'rgba(255,255,255,0.4)', 
                        marginTop: '0.5rem',
                        fontFamily: 'inherit',
                        lineHeight: '1.5'
                      }}>
                        (true = current node is right child / sibling on left, false = current node is left child / sibling on right)
                      </div>
                    </div>
                  </div>

                  {/* 5. Verify On-chain */}
                  {deployedTokenAddress && (
                    <div style={{ 
                      marginTop: '2rem'
                    }}>
                      <div style={{ marginBottom: '1rem' }}>
                        <h3 style={{ 
                          fontSize: 'clamp(1.1rem, 2.5vw, 1.25rem)',
                          fontWeight: '500',
                          marginBottom: '0.5rem',
                          letterSpacing: '-0.01em',
                          color: 'rgba(255,255,255,0.95)'
                        }}>
                          5. Verify Proof On-chain
                        </h3>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)' }}>
                          Call the deployed contract to cryptographically verify this <Tooltip content="A Merkle proof shows that a specific field is part of the committed descriptor">proof on the blockchain</Tooltip>
                        </p>
                      </div>
                      
                      <div style={{ 
                        padding: '1.5rem',
                        background: onChainVerificationStatus === null ? 'rgba(255, 255, 255, 0.03)' :
                                    onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.05)' :
                                    onChainVerificationStatus === 'failed' ? 'rgba(239, 68, 68, 0.05)' :
                                    'rgba(59, 130, 246, 0.05)',
                        border: onChainVerificationStatus === null ? '1px solid rgba(255, 255, 255, 0.1)' :
                                onChainVerificationStatus === 'success' ? '1px solid rgba(34, 197, 94, 0.2)' :
                                onChainVerificationStatus === 'failed' ? '1px solid rgba(239, 68, 68, 0.2)' :
                                '1px solid rgba(59, 130, 246, 0.2)',
                        borderRadius: '8px',
                        transition: 'all 0.3s ease'
                      }}>
                        <div style={{
                          fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                          color: 'rgba(255,255,255,0.8)',
                          marginBottom: '1rem'
                        }}>
                          <strong style={{ 
                            color: onChainVerificationStatus === null ? 'rgba(255,255,255,0.7)' :
                                   onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.9)' :
                                   onChainVerificationStatus === 'failed' ? 'rgba(239, 68, 68, 0.9)' :
                                   'rgba(59, 130, 246, 0.9)'
                          }}>
                            {onChainVerificationStatus === null ? 'Ready for Onchain Verification' :
                             onChainVerificationStatus === 'success' ? 'Verified Onchain' :
                             onChainVerificationStatus === 'failed' ? 'Verification Failed' :
                             'Verifying...'}
                          </strong>
                        <div style={{ 
                          fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)', 
                          color: 'rgba(255,255,255,0.6)',
                          marginTop: '0.25rem',
                          fontFamily: 'ui-monospace, monospace',
                          wordBreak: 'break-all',
                          overflowWrap: 'break-word'
                        }}>
                          <AddressLink address={deployedTokenAddress} chainId={chainFromEnv.id} />
                        </div>
                      </div>
                      
                      <button
                        onClick={verifyProofOnChain}
                        disabled={loading || onChainVerificationStatus === 'pending'}
                        style={{
                          background: loading || onChainVerificationStatus === 'pending' ? 
                            'rgba(59, 130, 246, 0.2)' : 
                            onChainVerificationStatus === 'success' ? 
                            'rgba(34, 197, 94, 0.15)' :
                            onChainVerificationStatus === 'failed' ?
                            'rgba(239, 68, 68, 0.15)' :
                            'rgba(255, 255, 255, 0.1)',
                          color: loading || onChainVerificationStatus === 'pending' ? 
                            'rgba(59, 130, 246, 0.7)' :
                            onChainVerificationStatus === 'success' ? 
                            'rgba(34, 197, 94, 0.9)' :
                            onChainVerificationStatus === 'failed' ?
                            'rgba(239, 68, 68, 0.9)' :
                            'rgba(255, 255, 255, 0.9)',
                          border: `1px solid ${
                            loading || onChainVerificationStatus === 'pending' ?
                            'rgba(59, 130, 246, 0.3)' :
                            onChainVerificationStatus === 'success' ?
                            'rgba(34, 197, 94, 0.3)' :
                            onChainVerificationStatus === 'failed' ?
                            'rgba(239, 68, 68, 0.3)' :
                            'rgba(255, 255, 255, 0.2)'
                          }`,
                          borderRadius: '6px',
                          padding: '0.875rem 1.5rem',
                          fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                          fontWeight: '600',
                          cursor: loading || onChainVerificationStatus === 'pending' ? 'not-allowed' : 'pointer',
                          width: '100%',
                          transition: 'all 0.2s',
                          minHeight: '44px'
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.25)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!loading) {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.15)';
                          }
                        }}
                      >
                        {loading || onChainVerificationStatus === 'pending' ? 'Verifying Onchain...' :
                         onChainVerificationStatus === 'success' ? 'Re-verify Proof' :
                         onChainVerificationStatus === 'failed' ? 'Try Again' :
                         'Verify Proof Onchain'}
                      </button>
                      
                      {proofVerificationInfo && (
                        <div style={{
                          marginTop: '1rem',
                          padding: '1rem',
                          background: onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          border: `1px solid ${onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                          borderRadius: '6px',
                          fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                          color: onChainVerificationStatus === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
                          wordBreak: 'break-all',
                          fontFamily: 'ui-monospace, monospace',
                          lineHeight: '1.6',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {proofVerificationInfo}
                        </div>
                      )}
                      
                      <div style={{
                        fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                        color: 'rgba(255,255,255,0.5)',
                        marginTop: '0.75rem',
                        lineHeight: '1.5'
                      }}>
                        This will call the <code style={{ 
                          background: 'rgba(0,0,0,0.3)', 
                          padding: '0.125rem 0.25rem', 
                          borderRadius: '3px',
                          fontSize: 'inherit'
                        }}>verifyField()</code> function on your deployed token contract to verify the proof cryptographically onchain.
                      </div>
                    </div>
                  </div>
                )}
                </div>
              )}
            </section>

            {/* Fetch FIX Message from Contract */}
            {deployedTokenAddress && (
              <section ref={retrieveRef} style={{ marginBottom: '4rem' }}>
                <div style={{ marginBottom: '2rem' }}>
                <h2 style={{  
                    fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', 
                    fontWeight: '500',
                    marginBottom: '0.5rem',
                    letterSpacing: '-0.01em'
                  }}>
                    6. Retrieve & Decode Data
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(0.875rem, 2vw, 0.95rem)' }}>
                    Fetch the <Tooltip content="The SBE binary-encoded FIX message stored using SSTORE2">encoded data</Tooltip> from the deployed contract and decode it back to the original FIX message
                  </p>
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 'clamp(0.75rem, 2vw, 0.85rem)',
                    color: 'rgba(255,255,255,0.7)',
                    wordBreak: 'break-all',
                    overflowWrap: 'break-word'
                  }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>Token: </span>
                    <AddressLink address={deployedTokenAddress} chainId={chainFromEnv.id} />
                  </div>
                </div>

                <div style={{
                  padding: '2rem',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px'
                }}>
                  <button
                    onClick={() => {
                      fetchSBEFromContract();
                    }}
                    disabled={fetchSBEStatus === 'loading'}
                    style={{
                      background: fetchSBEStatus === 'loading' ?
                        'rgba(59, 130, 246, 0.2)' :
                        fetchSBEStatus === 'success' ?
                        'rgba(34, 197, 94, 0.15)' :
                        fetchSBEStatus === 'error' ?
                        'rgba(239, 68, 68, 0.15)' :
                        'rgba(255, 255, 255, 0.1)',
                      color: fetchSBEStatus === 'loading' ?
                        'rgba(59, 130, 246, 0.9)' :
                        fetchSBEStatus === 'success' ?
                        'rgba(34, 197, 94, 0.9)' :
                        fetchSBEStatus === 'error' ?
                        'rgba(239, 68, 68, 0.9)' :
                        'rgba(255, 255, 255, 0.9)',
                      border: `1px solid ${
                        fetchSBEStatus === 'loading' ?
                        'rgba(59, 130, 246, 0.3)' :
                        fetchSBEStatus === 'success' ?
                        'rgba(34, 197, 94, 0.3)' :
                        fetchSBEStatus === 'error' ?
                        'rgba(239, 68, 68, 0.3)' :
                        'rgba(255, 255, 255, 0.2)'
                      }`,
                      borderRadius: '6px',
                      padding: '0.875rem 1.5rem',
                      fontSize: 'clamp(0.85rem, 2vw, 0.9rem)',
                      fontWeight: '600',
                      cursor: fetchSBEStatus === 'loading' ? 'not-allowed' : 'pointer',
                      width: '100%',
                      transition: 'all 0.2s',
                      marginBottom: '1.5rem',
                      minHeight: '44px'
                    }}
                  >
                    {fetchSBEStatus === 'loading' ? 'Fetching from Contract...' :
                     fetchSBEStatus === 'success' ? 'Fetch Again' :
                     fetchSBEStatus === 'error' ? 'Retry' :
                     'Fetch FIX Message from Contract'}
                  </button>

                  {fetchSBEError && (
                    <div style={{
                      padding: '1rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      color: 'rgba(239, 68, 68, 0.9)',
                      fontSize: '0.875rem',
                      marginBottom: '1.5rem'
                    }}>
                      Error: {fetchSBEError}
                    </div>
                  )}

                  {fetchedSBE && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <div style={{
                          fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                          color: 'rgba(255,255,255,0.5)',
                          marginBottom: '0.75rem',
                          fontWeight: '500',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          Raw SBE (Hex)
                        </div>
                        <textarea 
                          readOnly
                          value={fetchedSBE || ''}
                          rows={4}
                          style={{
                            width: '100%',
                            padding: '1rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.03)',
                            color: 'rgba(255,255,255,0.7)',
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                            resize: 'vertical',
                            lineHeight: '1.6',
                            boxSizing: 'border-box',
                            wordBreak: 'break-all'
                          }}
                        />
                        <div style={{
                          fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                          color: 'rgba(255,255,255,0.4)',
                          marginTop: '0.5rem',
                          lineHeight: '1.5'
                        }}>
                          This is the SBE encoding retrieved from the contract&apos;s SSTORE2 data pointer
                        </div>
                      </div>

                      {decodedFIX && (
                        <div>
                          <div style={{
                            fontSize: '0.8rem',
                            color: 'rgba(255,255,255,0.5)',
                            marginBottom: '0.75rem',
                            fontWeight: '500',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            Decoded FIX Message (Off-chain)
                          </div>
                          {/* Off-chain decoded view */}
                          {decodedFIX && (
                            <>
                              {/* Sub-toggle for numeric vs named */}
                              <div style={{
                                display: 'flex',
                                gap: '0.5rem',
                                marginBottom: '0.75rem',
                                padding: '0.25rem',
                                background: 'rgba(255,255,255,0.02)',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.08)'
                              }}>
                                <button
                                  onClick={() => setOffchainFormat('numeric')}
                                  style={{
                                    flex: 1,
                                    padding: '0.5rem',
                                    fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                                    background: offchainFormat === 'numeric' 
                                      ? 'rgba(59, 130, 246, 0.15)' 
                                      : 'transparent',
                                    border: offchainFormat === 'numeric'
                                      ? '1px solid rgba(59, 130, 246, 0.3)'
                                      : '1px solid transparent',
                                    borderRadius: '4px',
                                    color: offchainFormat === 'numeric'
                                      ? 'rgba(59, 130, 246, 0.9)'
                                      : 'rgba(255,255,255,0.5)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    minHeight: '44px'
                                  }}
                                >
                                  #️⃣ Numeric Tags
                                </button>
                                <button
                                  onClick={() => setOffchainFormat('named')}
                                  style={{
                                    flex: 1,
                                    padding: '0.5rem',
                                    fontSize: 'clamp(0.75rem, 1.5vw, 0.8rem)',
                                    background: offchainFormat === 'named' 
                                      ? 'rgba(59, 130, 246, 0.15)' 
                                      : 'transparent',
                                    border: offchainFormat === 'named'
                                      ? '1px solid rgba(59, 130, 246, 0.3)'
                                      : '1px solid transparent',
                                    borderRadius: '4px',
                                    color: offchainFormat === 'named'
                                      ? 'rgba(59, 130, 246, 0.9)'
                                      : 'rgba(255,255,255,0.5)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    minHeight: '44px'
                                  }}
                                >
                                  📝 Tag Names
                                </button>
                              </div>

                              <textarea
                                readOnly
                                value={(offchainFormat === 'numeric' ? decodedFIX : decodedFIXNamed) || ''}
                                rows={6}
                                style={{
                                  width: '100%',
                                  padding: '1rem',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(59, 130, 246, 0.2)',
                                  background: 'rgba(59, 130, 246, 0.05)',
                                  color: 'rgba(59, 130, 246, 0.9)',
                                  fontFamily: 'ui-monospace, monospace',
                                  fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
                                  resize: 'vertical',
                                  lineHeight: '1.6',
                                  fontWeight: '500',
                                  boxSizing: 'border-box',
                                  wordBreak: 'break-word'
                                }}
                              />
                              <div style={{
                                fontSize: 'clamp(0.7rem, 1.5vw, 0.75rem)',
                                color: 'rgba(255,255,255,0.4)',
                                marginTop: '0.5rem',
                                lineHeight: '1.5'
                              }}>
                                {offchainFormat === 'numeric' 
                                  ? 'Decoded off-chain using fixparser library. Shows numeric tags (e.g., "55=AAPL").'
                                  : 'Decoded off-chain with tag names from the loaded Orchestra XML schema. Shows human-readable names (e.g., "Symbol=AAPL"). Dictionary source: Orchestra schema fields (off-chain).'}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}

      </div>

      {/* Footer */}
      <footer style={{ 
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: 'clamp(2rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem)',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <p style={{ 
            color: 'rgba(255,255,255,0.5)',
            fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
            marginBottom: '0.5rem'
          }}>
            Transform FIX descriptors into verifiable onchain commitments
          </p>
          <p style={{ 
            color: 'rgba(255,255,255,0.5)',
            fontSize: 'clamp(0.8rem, 2vw, 0.875rem)',
            marginBottom: '1rem'
          }}>
            ERC-FIX by{' '}
            <a
              href="https://nethermind.io"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'rgba(255, 255, 255, 0.7)',
                textDecoration: 'none',
                transition: 'color 0.2s',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: '0.5rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              }}
            >
              <Image 
                src="/nethermind-icon.svg" 
                alt="Nethermind"
                width={19}
                height={19}
                style={{ 
                  display: 'block',
                  transform: 'translateY(0.25rem)',
                  marginLeft: '0.25rem'
                }} 
              />
              Nethermind
            </a>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'clamp(1rem, 3vw, 2rem)', fontSize: 'clamp(0.8rem, 2vw, 0.875rem)' }}>
              <a 
                href="https://github.com/NethermindEth/fix-descriptor" 
                style={{ color: 'rgba(255,255,255,0.4)', transition: 'color 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
              >
                GitHub
              </a>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
            <a 
              href="/spec" 
              style={{ color: 'rgba(255,255,255,0.4)', transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
            >
              Specification
            </a>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
            <a 
              href="/problem" 
              style={{ color: 'rgba(255,255,255,0.4)', transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
            >
              Problem Statement
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
