import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DOMParser } from '@xmldom/xmldom';
import {
    hashOrchestraFile,
    orchestraToSbeFullSchema,
    orchestraToSbe,
    extractMessageIdFromSbe,
} from '../src/orchestraToSbe';

(globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser = DOMParser;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const LIB_ORCHESTRA_PATH = resolve(PACKAGE_ROOT, 'lib', 'ORCHESTRAFIX44.xml');

// Example Orchestra XML. Structure mirrors Orchestra spec: fixr:fields, fixr:messages, fixr:structure, fixr:fieldRef.
const EXAMPLE_ORCHESTRA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="Example" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="11" name="ClOrdID" type="String">
      <fixr:annotation><fixr:documentation>Unique identifier for the order</fixr:documentation></fixr:annotation>
    </fixr:field>
    <fixr:field id="38" name="OrderQty" type="Qty">
      <fixr:annotation><fixr:documentation>Quantity of the order</fixr:documentation></fixr:annotation>
    </fixr:field>
    <fixr:field id="44" name="Price" type="Price">
      <fixr:annotation><fixr:documentation>Price of the order</fixr:documentation></fixr:annotation>
    </fixr:field>
    <fixr:field id="55" name="Symbol" type="String">
      <fixr:annotation><fixr:documentation>Security symbol</fixr:documentation></fixr:annotation>
    </fixr:field>
  </fixr:fields>
  <fixr:messages>
    <fixr:message name="Order" id="1" msgType="D" category="SingleGeneralOrderHandling">
      <fixr:structure>
        <fixr:fieldRef id="11" presence="required"/>
        <fixr:fieldRef id="38" presence="required"/>
        <fixr:fieldRef id="44" presence="required"/>
        <fixr:fieldRef id="55" presence="required"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;

/** Assert SBE schema contains Order message and the four expected fields with correct id/name/type. */
function assertOrderMessageAccuracy(sbeSchema: string) {
    expect(sbeSchema).toContain('name="Order"');
    expect(sbeSchema).toContain('id="1"');
    // String → varStringEncoding (rendered as <data>)
    expect(sbeSchema).toMatch(/name="ClOrdID"\s+id="11"/);
    expect(sbeSchema).toContain('id="11"');
    expect(sbeSchema).toMatch(/ClOrdID.*varStringEncoding|varStringEncoding.*ClOrdID/);
    // Qty → int64 (<field>)
    expect(sbeSchema).toMatch(/name="OrderQty"\s+id="38"\s+type="int64"/);
    // Price → int64
    expect(sbeSchema).toMatch(/name="Price"\s+id="44"\s+type="int64"/);
    // Symbol → varStringEncoding (<data>)
    expect(sbeSchema).toMatch(/name="Symbol"\s+id="55"/);
    expect(sbeSchema).toMatch(/Symbol.*varStringEncoding|varStringEncoding.*Symbol/);
}

describe('Orchestra to SBE Conversion Tests', () => {
    describe('Conversion accuracy', () => {
        it('hashOrchestraFile: format, determinism, and sensitivity', () => {
            const hash = hashOrchestraFile(EXAMPLE_ORCHESTRA_XML);
            expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
            expect(hashOrchestraFile(EXAMPLE_ORCHESTRA_XML)).toBe(hash);
            const modified = EXAMPLE_ORCHESTRA_XML.replace('Order', 'OrderX');
            expect(hashOrchestraFile(modified)).not.toBe(hash);
        });

        it('orchestraToSbeFullSchema produces Order message with correct fields and types', () => {
            const sbeSchema = orchestraToSbeFullSchema(EXAMPLE_ORCHESTRA_XML);
            assertOrderMessageAccuracy(sbeSchema);
            // Exactly one message in this fixture
            const messageMatches = sbeSchema.match(/<sbe:message\s+name="Order"/g);
            expect(messageMatches).toHaveLength(1);
        });

        it('orchestraToSbe(Order) produces same message and field accuracy', () => {
            const sbeSchema = orchestraToSbe(EXAMPLE_ORCHESTRA_XML, 'Order');
            assertOrderMessageAccuracy(sbeSchema);
        });

        it('extractMessageIdFromSbe returns correct id, null for missing message, null for invalid XML', () => {
            const sbeSchema = orchestraToSbeFullSchema(EXAMPLE_ORCHESTRA_XML);
            expect(extractMessageIdFromSbe(sbeSchema, 'Order')).toBe('1');
            expect(extractMessageIdFromSbe(sbeSchema, 'NonExistent')).toBeNull();
            expect(extractMessageIdFromSbe('<invalid>', 'Order')).toBeNull();
        });
    });

    describe('Error handling', () => {
        it('orchestraToSbeFullSchema throws for invalid XML', () => {
            expect(() => orchestraToSbeFullSchema('<invalid><unclosed>')).toThrow();
        });

        it('orchestraToSbeFullSchema throws when no messages', () => {
            const emptyOrchestra = `<?xml version="1.0" encoding="UTF-8"?>
<repository name="Empty" xmlns="http://fixprotocol.io/2020/orchestra/repository">
  <messages></messages>
</repository>`;
            expect(() => orchestraToSbeFullSchema(emptyOrchestra)).toThrow('No message definitions found');
        });

        it('orchestraToSbe throws when message type omitted', () => {
            expect(() => orchestraToSbe(EXAMPLE_ORCHESTRA_XML)).toThrow('Message type is required');
        });

        it('orchestraToSbe throws for non-existent message type', () => {
            expect(() => orchestraToSbe(EXAMPLE_ORCHESTRA_XML, 'NonExistentMessage')).toThrow();
        });

        it('orchestraToSbe throws when message has no valid fields', () => {
            // Message structure has fieldRefs whose ids are not in <fields> (or empty structure)
            const noFieldsOrchestra = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="Bad" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="11" name="ClOrdID" type="String"/>
  </fixr:fields>
  <fixr:messages>
    <fixr:message name="EmptyMsg" id="99" msgType="X">
      <fixr:structure>
        <fixr:fieldRef id="999" presence="required"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;
            expect(() => orchestraToSbe(noFieldsOrchestra, 'EmptyMsg')).toThrow('No valid fields found');
        });
    });

    // Edge cases and conditions from FIX Orchestra Technical Specification (v1.0):
    // presence (required/optional), field type domain (datatype vs code set), componentRef, groupRef, numInGroup.
    describe('Orchestra spec: presence and types', () => {
        it('optional fieldRef produces SBE presence="optional" and nullValue', () => {
            const optionalFieldOrchestra = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="Opt" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="38" name="OrderQty" type="Qty"/>
  </fixr:fields>
  <fixr:messages>
    <fixr:message name="MinOrder" id="1" msgType="D">
      <fixr:structure>
        <fixr:fieldRef id="38" presence="optional"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;
            const sbe = orchestraToSbe(optionalFieldOrchestra, 'MinOrder');
            expect(sbe).toContain('presence="optional"');
            expect(sbe).toContain('nullValue="');
            expect(sbe).toMatch(/name="OrderQty"\s+id="38"\s+type="int64"/);
        });

        it('field with CodeSet type maps to varStringEncoding', () => {
            const codeSetOrchestra = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="CodeSet" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="59" name="TimeInForce" type="TimeInForceCodeSet"/>
  </fixr:fields>
  <fixr:messages>
    <fixr:message name="TIF" id="1" msgType="D">
      <fixr:structure>
        <fixr:fieldRef id="59" presence="required"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;
            const sbe = orchestraToSbe(codeSetOrchestra, 'TIF');
            expect(sbe).toMatch(/name="TimeInForce"\s+id="59"/);
            expect(sbe).toMatch(/TimeInForce.*varStringEncoding|varStringEncoding.*TimeInForce/);
        });
    });

    // Spec: component = sequence of fields reused by componentRef; group = repeating block, pointer is groupRef, numInGroup = count field.
    describe('Orchestra spec: componentRef and groupRef', () => {
        it('componentRef expands component fields into SBE message', () => {
            const withComponent = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="Comp" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="1" name="Account" type="String"/>
    <fixr:field id="11" name="ClOrdID" type="String"/>
  </fixr:fields>
  <fixr:components>
    <fixr:component name="AccountBlock" id="1000">
      <fixr:fieldRef id="1"/>
    </fixr:component>
  </fixr:components>
  <fixr:messages>
    <fixr:message name="OrderWithAcct" id="1" msgType="D">
      <fixr:structure>
        <fixr:fieldRef id="11" presence="required"/>
        <fixr:componentRef id="1000" presence="optional"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;
            const sbe = orchestraToSbe(withComponent, 'OrderWithAcct');
            expect(sbe).toContain('name="OrderWithAcct"');
            expect(sbe).toMatch(/name="Account"\s+id="1"/);
            expect(sbe).toMatch(/name="ClOrdID"\s+id="11"/);
        });

        it('groupRef produces SBE group with dimensionType groupSizeEncoding', () => {
            const withGroup = `<?xml version="1.0" encoding="UTF-8"?>
<fixr:repository name="Grp" xmlns:fixr="http://fixprotocol.io/2020/orchestra/repository">
  <fixr:fields>
    <fixr:field id="454" name="NoSecurityAltID" type="NumInGroup"/>
    <fixr:field id="455" name="SecurityAltID" type="String"/>
  </fixr:fields>
  <fixr:groups>
    <fixr:group name="SecAltIDGrp" id="1011">
      <fixr:numInGroup id="454"/>
      <fixr:fieldRef id="455"/>
    </fixr:group>
  </fixr:groups>
  <fixr:messages>
    <fixr:message name="WithGroup" id="1" msgType="d">
      <fixr:structure>
        <fixr:groupRef id="1011" presence="optional"/>
      </fixr:structure>
    </fixr:message>
  </fixr:messages>
</fixr:repository>`;
            const sbe = orchestraToSbe(withGroup, 'WithGroup');
            expect(sbe).toContain('dimensionType="groupSizeEncoding"');
            expect(sbe).toMatch(/<group\s+name="SecAltIDGrp"\s+id="454"/);
            expect(sbe).toMatch(/name="SecurityAltID"\s+id="455"/);
        });
    });

    describe('Full Orchestra file (when present)', () => {
        it('converts lib ORCHESTRAFIX44.xml and preserves known message ids', () => {
            if (!existsSync(LIB_ORCHESTRA_PATH)) {
                console.warn('lib/ORCHESTRAFIX44.xml not found, skipping');
                return;
            }
            const xml = readFileSync(LIB_ORCHESTRA_PATH, 'utf-8');
            const sbeSchema = orchestraToSbeFullSchema(xml);
            expect(sbeSchema).toContain('name="Heartbeat" id="1"');
            expect(sbeSchema).toContain('name="SecurityDefinition" id="37"');
        });
    });
});
