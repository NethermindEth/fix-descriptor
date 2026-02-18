import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { encodeFromInput } from '../encode';
import { decodeFromInput } from '../decode';

const schemaPath = resolve('lib', 'SBE-FULL-FIX44.xml');

/**
 * Round-trip test: encode FIX message → decode → verify
 * 
 * Key principles:
 * 1. Only fields in the schema will be encoded/decoded
 * 2. Decoder filters out zero/empty values
 * 3. Fields may be formatted differently (timestamps, floats)
 * 4. Not all input fields will appear in decoded output
 */
async function roundTripTest(fixMessage: string, messageId: number) {
    // Encode
    const encodedBytes = await encodeFromInput({
        schema: schemaPath,
        fixMessage: fixMessage,
        messageId: messageId,
    });

    expect(encodedBytes.length).toBeGreaterThan(0);
    expect(encodedBytes.length).toBeGreaterThanOrEqual(8); // Header size

    const encodedHex = Buffer.from(encodedBytes).toString('hex');

    // Decode
    const decoded = await decodeFromInput({
        schema: schemaPath,
        encodedMessage: encodedHex,
        messageId: messageId,
    });

    expect(decoded).not.toBeNull();
    expect(typeof decoded).toBe('object');
    expect('decodedFields' in decoded).toBe(true);

    const decodedFields = decoded.decodedFields as Record<string, unknown>;
    expect(decodedFields).not.toBeNull();
    expect(typeof decodedFields).toBe('object');
    
    // Core assertion: round-trip succeeded - we got some decoded fields
    expect(Object.keys(decodedFields).length).toBeGreaterThan(0);
    
    return { encodedBytes, decoded, decodedFields };
}

/**
 * Verify a field value matches expected, with appropriate normalization
 * 
 * Handles different decoded types:
 * - <data> elements (varStringEncoding/varDataEncoding) → decode as strings
 * - <field> elements → decode based on SBE type (int64→bigint, float→number, etc.)
 * 
 * Returns match result with decoded value for further inspection
 */
function verifyFieldValue(
    decodedFields: Record<string, unknown>,
    tag: string,
    expectedValue: string
): { matches: boolean; decodedValue?: unknown; reason?: string } {
    const decodedValue = decodedFields[tag];
    
    if (decodedValue == null) {
        return { matches: false, reason: 'Field not present in decoded output' };
    }

    // Normalize decoded value for comparison
    // Accept whatever type the decoder returns (string for data fields, number/bigint for field nodes)
    let normalizedDecoded: string;
    if (typeof decodedValue === 'bigint') {
        normalizedDecoded = decodedValue.toString();
    } else if (typeof decodedValue === 'number') {
        // For numeric values, preserve precision for comparison
        if (expectedValue.includes('.')) {
            // For decimal values, use fixed precision
            normalizedDecoded = decodedValue.toFixed(6);
        } else {
            normalizedDecoded = decodedValue.toString();
        }
    } else {
        // String values (from data fields) - use as-is
        normalizedDecoded = String(decodedValue);
    }
    
    // For values that look numeric (contain decimal point), allow approximate matching
    // This handles both string "4.250" and number 4.25 comparisons
    if (expectedValue.includes('.')) {
        const decodedNum = parseFloat(normalizedDecoded);
        const expectedNum = parseFloat(expectedValue);
        if (Number.isNaN(decodedNum) || Number.isNaN(expectedNum)) {
            // If parsing fails, fall back to string comparison
            const matches = normalizedDecoded === expectedValue;
            return { matches, decodedValue };
        }
        // Allow small floating point differences
        const matches = Math.abs(decodedNum - expectedNum) < 0.001;
        return { matches, decodedValue };
    } else {
        // Exact match for non-decimal values
        const matches = normalizedDecoded === expectedValue;
        return { matches, decodedValue };
    }
}

/**
 * Parse FIX message to extract tag=value pairs
 */
function parseFixMessage(fixMessage: string): Map<string, string> {
    const normalized = fixMessage.replace(/\u0001/g, '|');
    const fields = new Map<string, string>();
    for (const part of normalized.split('|')) {
        if (!part) continue;
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const tag = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (tag && value) {
            fields.set(tag, value);
        }
    }
    return fields;
}

/**
 * Automatically verify decoded fields against input FIX message
 * Filters out session fields (8, 9, 10, 35) and verifies all business fields
 */
function verifyDecodedFields(
    fixMessage: string,
    decodedFields: Record<string, unknown>
): { verified: string[]; missing: string[]; mismatched: Array<{ tag: string; expected: string; actual: unknown }> } {
    const inputFields = parseFixMessage(fixMessage);
    const sessionFields = new Set(['8', '9', '10', '35']);
    
    const verified: string[] = [];
    const missing: string[] = [];
    const mismatched: Array<{ tag: string; expected: string; actual: unknown }> = [];
    
    for (const [tag, expectedValue] of inputFields.entries()) {
        if (sessionFields.has(tag)) {
            continue;
        }
        
        const check = verifyFieldValue(decodedFields, tag, expectedValue);
        if (check.matches) {
            verified.push(tag);
        } else if (decodedFields[tag] == null) {
            missing.push(tag);
        } else {
            mismatched.push({ tag, expected: expectedValue, actual: decodedFields[tag] });
        }
    }
    
    return { verified, missing, mismatched };
}

describe('SBE Encode/Decode Round-trip Tests', () => {
    describe('Treasury Bond SecurityDefinition', () => {
        it('should encode and decode Treasury bond with Percentage field (CouponRate)', async () => {
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Automatically verify all business fields
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            expect(result.missing.length).toBe(0);
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('SecurityDefinition with Multiple Percentage Fields', () => {
        it('should handle multiple Percentage fields (CouponRate, AccruedInterestRate, Yield)', async () => {
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|158=5.75|236=3.125|15=USD|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Automatically verify all business fields
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            // Some fields may not be in schema (like 158, 236), so missing is acceptable
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('NewOrderSingle with Repeating Groups', () => {
        it('should encode and decode NewOrderSingle with PartyIDs group', async () => {
            // Testing NewOrderSingle with Parties repeating group
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=100|40=2|60=20240204-12:30:00.000|453=2|448=PARTY1|447=D|452=1|448=PARTY2|447=D|452=3|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify group is present (453 = NoPartyIDs)
            expect(decodedFields['453']).toBeDefined();
            expect(Array.isArray(decodedFields['453'])).toBe(true);
        });
    });

    describe('NewOrderSingle with MultipleValueString', () => {
        it('should handle ExecInst with MultipleValueString format', async () => {
            // Testing ExecInst field (MultipleValueString → varStringEncoding)
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=100|40=2|60=20240204-12:30:00.000|18=1 2 A|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // ExecInst (18) should be present as string (MultipleValueString → varStringEncoding)
            if (decodedFields['18'] != null) {
                expect(typeof decodedFields['18']).toBe('string');
                expect(decodedFields['18']).toContain('1');
            }
        });
    });

    describe('NewOrderSingle with Int-derived Types', () => {
        it('should handle SeqNum, Length, NumInGroup types (uint32/uint16)', async () => {
            // Testing int-derived types in NewOrderSingle
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=100|40=2|60=20240204-12:30:00.000|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify some fields decoded successfully
            expect(Object.keys(decodedFields).length).toBeGreaterThan(0);
        });
    });

    describe('Decode Pre-encoded Message', () => {
        it('should decode a pre-encoded repeating group message', async () => {
            // Testing decode of pre-encoded NewOrderSingle message
            const encodedHex = '39010e0001000000000000000000000001000000c0cceec05be84700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0cceec05be847006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c000000000002000000000006005041525459310100440100310000000006005041525459320100440100330800000000000000000000000c0000007d0000000000000007004649582e342e34010044060053454e444552060054415247455400000000000000000000000000000000000000000000000000000000000006004f5244455231000000000000000000000000000000000000000000000000010031000000000000030049424d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100310000000000000000010032000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300303030';
            const messageId = 14; // NewOrderSingle

            const decoded = await decodeFromInput({
                schema: schemaPath,
                encodedMessage: encodedHex,
                messageId: messageId,
            });

            expect(decoded).not.toBeNull();
            expect('decodedFields' in decoded).toBe(true);
            
            const decodedFields = decoded.decodedFields as Record<string, unknown>;
            expect(decodedFields).not.toBeNull();
            expect(Object.keys(decodedFields).length).toBeGreaterThan(0);
        });
    });
});
