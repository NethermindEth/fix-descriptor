import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http, decodeEventLog, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { abi as TokenFactoryAbi } from '@/lib/abis/AssetTokenFactory';

/**
 * POST /api/deploy-token
 *
 * Deploys a token with descriptor from the backend using AssetTokenFactory
 * No wallet connection required - backend absorbs gas costs
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      symbol,
      initialSupply,
      sbeHex,
      cborHex, // Legacy support
      root,
      schemaXml,
      schemaHash: schemaHashFromRequest
    } = body;
    
    // Use sbeHex if provided, otherwise fall back to cborHex for backward compatibility
    const dataHex = sbeHex || cborHex;

    // Validate inputs
    if (!name || !symbol || !initialSupply) {
      return NextResponse.json(
        { error: 'Missing required token parameters (name, symbol, initialSupply)' },
        { status: 400 }
      );
    }

    if (!dataHex || !root) {
      return NextResponse.json(
        { error: 'Missing descriptor data (sbeHex or cborHex, root)' },
        { status: 400 }
      );
    }

    if (!schemaXml || typeof schemaXml !== 'string') {
      return NextResponse.json(
        { error: 'Missing schemaXml (generated SBE schema XML)' },
        { status: 400 }
      );
    }

    // Get environment variables
    const privateKey = process.env.PRIVATE_KEY;
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
    const factoryAddress = process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS;
    const gistToken = process.env.GITHUB_GIST_TOKEN;

    if (!privateKey) {
      return NextResponse.json(
        { error: 'Backend wallet not configured (PRIVATE_KEY missing)' },
        { status: 500 }
      );
    }

    if (!rpcUrl) {
      return NextResponse.json(
        { error: 'RPC URL not configured (NEXT_PUBLIC_RPC_URL missing)' },
        { status: 500 }
      );
    }

    if (!factoryAddress) {
      return NextResponse.json(
        { error: 'Token factory not configured (NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS missing)' },
        { status: 500 }
      );
    }

    if (!gistToken) {
      return NextResponse.json(
        { error: 'Gist upload not configured (GITHUB_GIST_TOKEN missing)' },
        { status: 500 }
      );
    }

    const gistResponse = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gistToken}`,
        'User-Agent': 'fix-descriptor-web'
      },
      body: JSON.stringify({
        description: 'SBE schema for token deployment',
        public: true,
        files: {
          'schema.xml': {
            content: schemaXml
          }
        }
      })
    });

    if (!gistResponse.ok) {
      const errorText = await gistResponse.text();
      return NextResponse.json(
        { error: `Failed to upload schema to Gist: ${errorText}` },
        { status: 500 }
      );
    }

    const gistJson = await gistResponse.json();
    const schemaURI = gistJson?.files?.['schema.xml']?.raw_url;
    if (!schemaURI) {
      return NextResponse.json(
        { error: 'Gist upload succeeded but raw_url was missing' },
        { status: 500 }
      );
    }

    // Create wallet from private key
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Create wallet client for signing transactions
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl)
    });

    // Create public client for reading blockchain state
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl)
    });

    const schemaHash = (schemaHashFromRequest && typeof schemaHashFromRequest === 'string')
      ? (schemaHashFromRequest.startsWith('0x') ? schemaHashFromRequest : `0x${schemaHashFromRequest}`) as `0x${string}`
      : '0xb24215c985384ddaa6767272d452780aa4352201a1df669564cde3905cb6a215' as `0x${string}`;

    // Prepare descriptor (factory will set fixSBEPtr and fixSBELen)
    const descriptor = {
      schemaHash: schemaHash,
      fixRoot: root as `0x${string}`,
      fixSBEPtr: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      fixSBELen: 0,
      schemaURI: schemaURI
    };

    // Convert supply to wei (18 decimals)
    const supplyInWei = BigInt(initialSupply) * BigInt(10 ** 18);

    // Ensure data hex has 0x prefix
    const dataHexFormatted = dataHex.startsWith('0x')
      ? dataHex as `0x${string}`
      : `0x${dataHex}` as `0x${string}`;

    console.log('Deploying token with parameters:', {
      name,
      symbol,
      supply: supplyInWei.toString(),
      dataLength: dataHexFormatted.length,
      root,
      factoryAddress
    });

    // Simulate the transaction first to get better error messages
    try {
      await publicClient.simulateContract({
        address: factoryAddress as `0x${string}`,
        abi: TokenFactoryAbi,
        functionName: 'deployWithDescriptor',
        args: [
          name,
          symbol,
          supplyInWei,
          dataHexFormatted,
          descriptor
        ],
        account: account.address
      });
    } catch (simError: any) {
      console.error('Simulation failed:', simError);
      return NextResponse.json(
        { error: `Deployment would fail: ${simError.message}` },
        { status: 400 }
      );
    }

    // Deploy the token
    const hash = await walletClient.writeContract({
      address: factoryAddress as `0x${string}`,
      abi: TokenFactoryAbi,
      functionName: 'deployWithDescriptor',
      args: [
        name,
        symbol,
        supplyInWei,
        dataHexFormatted,
        descriptor
      ],
      gas: BigInt(5_000_000)
    });

    console.log('Transaction submitted:', hash);

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('Transaction confirmed:', {
      hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status
    });

    // Decode the AssetTokenDeployed event to get token address
    let tokenAddress: string | null = null;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: TokenFactoryAbi,
          data: log.data,
          topics: log.topics
        });

        if (decoded.eventName === 'AssetTokenDeployed') {
          const args = decoded.args as { tokenAddress?: Address; deployer?: Address; name?: string; symbol?: string; initialSupply?: bigint };
          if (args.tokenAddress) {
            tokenAddress = args.tokenAddress;
            console.log('Token deployed successfully:', {
              tokenAddress: args.tokenAddress,
              deployer: args.deployer,
              name: args.name,
              symbol: args.symbol,
              initialSupply: args.initialSupply?.toString()
            });
            break;
          }
        }
      } catch {
        // Skip logs that don't match our ABI
        continue;
      }
    }

    if (!tokenAddress) {
      console.warn('Could not decode token address from events, check transaction manually');
      tokenAddress = 'Check transaction';
    }

    // Return success response
    return NextResponse.json({
      success: true,
      transactionHash: hash,
      tokenAddress: tokenAddress,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status
    });

  } catch (error) {
    console.error('Error deploying token:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deploy-token
 *
 * Returns deployment information
 */
export async function GET() {
  return NextResponse.json({
    factoryAddress: process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS || null,
    dataFactoryAddress: process.env.NEXT_PUBLIC_DATA_FACTORY_ADDRESS || null,
    dictionaryAddress: process.env.NEXT_PUBLIC_DICTIONARY_ADDRESS || null,
    instructions: {
      step1: 'Generate FIX descriptor using /api/preview',
      step2: 'Deploy token using POST /api/deploy-token with { name, symbol, initialSupply, sbeHex, root, schemaURI (optional) }',
      step3: 'Backend handles wallet signing and gas fees automatically',
      step4: 'Receive tokenAddress and transactionHash in response'
    },
    gaslessDeployment: true,
    note: 'No wallet connection required - backend absorbs all gas costs'
  });
}
