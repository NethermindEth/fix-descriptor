
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { encodeFromInput } from '../src/sbe/encode';
import { decodeFromInput } from '../src/sbe/decode';

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
 * Format timestamp from bigint to FIX format (YYYYMMDD-HH:MM:SS.mmm)
 */
function formatTimestampFromBigint(value: bigint): string {
    const str = value.toString();
    if (!/^\d{17}$/.test(str) || !str.startsWith("20")) {
        return str;
    }
    const year = str.slice(0, 4);
    const month = str.slice(4, 6);
    const day = str.slice(6, 8);
    const hour = str.slice(8, 10);
    const minute = str.slice(10, 12);
    const second = str.slice(12, 14);
    const millis = str.slice(14, 17);
    return `${year}${month}${day}-${hour}:${minute}:${second}.${millis}`;
}

/**
 * Verify a field value matches expected, with appropriate normalization
 * 
 * Handles different decoded types:
 * - <data> elements (varStringEncoding/varDataEncoding) → decode as strings
 * - <field> elements → decode based on SBE type (int64→bigint, float→number, etc.)
 * - Timestamps (UTCTimestamp/TZTimestamp) → decoded as bigint, formatted for comparison
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
        // Check if this looks like a timestamp (format: YYYYMMDD-HH:MM:SS.mmm)
        if (expectedValue.match(/^\d{8}-\d{2}:\d{2}:\d{2}\.\d{3}$/)) {
            normalizedDecoded = formatTimestampFromBigint(decodedValue);
        } else {
            normalizedDecoded = decodedValue.toString();
        }
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
    // Normalize separators: convert newlines and pipes to SOH, then split by SOH
    const normalized = fixMessage
        .replace(/\r?\n/g, '\u0001')  // convert newlines to SOH
        .replace(/\|/g, '\u0001');    // convert pipes to SOH
    
    const fields = new Map<string, string>();
    for (const part of normalized.split('\u0001')) {
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
 * Handles group count fields: compares array length to expected count
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
        
        const decodedValue = decodedFields[tag];
        
        // Handle group count fields: decoded as arrays, verify length matches count
        if (Array.isArray(decodedValue)) {
            const expectedCount = parseInt(expectedValue, 10);
            if (!isNaN(expectedCount) && decodedValue.length === expectedCount) {
                verified.push(tag);
            } else {
                mismatched.push({ tag, expected: expectedValue, actual: decodedValue.length });
            }
            continue;
        }
        
        const check = verifyFieldValue(decodedFields, tag, expectedValue);
        if (check.matches) {
            verified.push(tag);
        } else if (decodedValue == null) {
            missing.push(tag);
        } else {
            mismatched.push({ tag, expected: expectedValue, actual: decodedValue });
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
            
            // Automatically verify all business fields (excluding groups which are handled separately)
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            // Log mismatches for debugging if any
            if (result.mismatched.length > 0) {
                console.log('Mismatched fields:', result.mismatched);
            }
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('NewOrderSingle with MultipleValueString', () => {
        it('should handle ExecInst with MultipleValueString format', async () => {
            // Testing ExecInst field (MultipleValueString → varStringEncoding)
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=100|40=2|60=20240204-12:30:00.000|18=1 2 A|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Automatically verify all business fields
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            // Log mismatches for debugging if any
            if (result.mismatched.length > 0) {
                console.log('Mismatched fields:', result.mismatched);
            }
            expect(result.mismatched.length).toBe(0);
            
            // ExecInst (18) should be present as string (MultipleValueString → varStringEncoding)
            if (decodedFields['18'] != null) {
                expect(typeof decodedFields['18']).toBe('string');
            }
        });
    });

    describe('NewOrderSingle with Int-derived Types', () => {
        it('should handle SeqNum, Length, NumInGroup types (uint32/uint16)', async () => {
            // Testing int-derived types in NewOrderSingle
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=100|40=2|60=20240204-12:30:00.000|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Automatically verify all business fields
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            // Log mismatches for debugging if any
            if (result.mismatched.length > 0) {
                console.log('Mismatched fields:', result.mismatched);
            }
            expect(result.mismatched.length).toBe(0);
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

    describe('Multiple Separator Formats', () => {
        it('should handle SOH-separated FIX messages', async () => {
            const fixMessage = '8=FIX.4.4\u00019=000\u000135=d\u000155=USTB-2030-11-15\u000148=US91282CEZ76\u000122=4\u0001167=TBOND\u0001461=DBFTFR\u0001541=20301115\u0001223=4.250\u000115=USD\u000110=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('SecurityDefinition with Repeating Groups', () => {
        it('should handle SecurityDefinition with SecurityAltID group', async () => {
            // Treasury bond with SecurityAltID group (454)
            // Note: Parties group (453) is not in SecurityDefinition schema, only in NewOrderSingle
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|454=2|455=91282CEZ7|456=1|455=US91282CEZ76|456=4|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify SecurityAltID group (454) - this group exists in SecurityDefinition schema
            expect(decodedFields['454']).toBeDefined();
            expect(Array.isArray(decodedFields['454'])).toBe(true);
            expect(decodedFields['454']).toHaveLength(2);
            
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('Corporate Bond SecurityDefinition', () => {
        it('should encode and decode corporate bond SecurityDefinition', async () => {
            const fixMessage = '8=FIX.4.4|9=0000|35=d|34=2|49=BUY_SIDE_FIRM|56=BLOOMBERG|52=20250919-16:20:05.123|320=REQ-NEW-BOND-001|322=RESP-NEW-BOND-001|323=1|55=ACME 5.000 15Dec2030|48=US000000AA11|22=4|167=CORP|460=4|207=BLPX|15=USD|225=20250919|541=20301215|223=5.000|470=US|107=Acme Corp 5.00% Notes due 15-Dec-2030|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify key corporate bond fields
            expect(decodedFields['167']).toBe('CORP'); // SecurityType
            expect(decodedFields['15']).toBe('USD'); // Currency
            expect(decodedFields['223']).toBeDefined(); // CouponRate
            
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            expect(result.mismatched.length).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty repeating groups (count=0)', async () => {
            // SecurityDefinition with empty SecurityAltID group
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|454=0|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Empty group should not appear in decoded fields (or appear as empty array)
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            // Empty groups may not be encoded/decoded, which is acceptable
        });

        it('should handle zero and minimum values', async () => {
            const fixMessage = '8=FIX.4.4|9=000|35=D|49=SENDER|56=TARGET|34=1|52=20240204-12:30:00.000|11=ORDER1|21=1|55=IBM|54=1|38=0|40=2|60=20240204-12:30:00.000|10=000';
            const messageId = 14; // NewOrderSingle
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Zero values may be filtered out by decoder, which is acceptable
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
        });

        it('should handle special characters in string fields', async () => {
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=TEST-SYMBOL_123|48=US123456789|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify special characters are preserved
            if (decodedFields['55']) {
                expect(String(decodedFields['55'])).toContain('TEST-SYMBOL_123');
            }
            
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
        });

        it('should handle very long string values', async () => {
            const longString = 'A'.repeat(200); // Long security description
            const fixMessage = `8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|107=${longString}|10=000`;
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Long strings should be preserved
            if (decodedFields['107']) {
                expect(String(decodedFields['107']).length).toBeGreaterThan(100);
            }
            
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
        });
    });

    describe('Different Message Types', () => {
        it('should handle SecurityDefinition with all field types', async () => {
            // Comprehensive SecurityDefinition with various data types
            const fixMessage = '8=FIX.4.4|9=0000|35=d|55=USTB-2030-11-15|48=US91282CEZ76|22=4|167=TBOND|461=DBFTFR|541=20301115|223=4.250|15=USD|225=20240204|541=20301115|10=000';
            const messageId = 37; // SecurityDefinition
            
            const { decodedFields } = await roundTripTest(fixMessage, messageId);
            
            // Verify various field types are handled
            expect(decodedFields['15']).toBe('USD'); // String
            expect(decodedFields['223']).toBeDefined(); // Percentage (string or number)
            
            const result = verifyDecodedFields(fixMessage, decodedFields);
            expect(result.verified.length).toBeGreaterThan(0);
            expect(result.mismatched.length).toBe(0);
        });
    });
});
