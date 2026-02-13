import { NextRequest, NextResponse } from 'next/server';
import { DEMO_FIX_SCHEMA, parseFixDescriptor, buildCanonicalTree } from '@fixdescriptorkit/ts-sdk';

export async function POST(req: NextRequest) {
  const { fixRaw } = await req.json();
  const tree = parseFixDescriptor(fixRaw, { schema: DEMO_FIX_SCHEMA });
  const canonical = buildCanonicalTree(tree);
  return NextResponse.json({ tree: canonical });
}
