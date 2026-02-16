// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/FixDescriptorLib.sol";
import "../src/IFixDescriptor.sol";
import "../src/SSTORE2.sol";

/// @title FixDescriptorLibTest
/// @notice Test suite for FixDescriptorLib library
contract FixDescriptorLibTest is Test {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    // Test contract that uses the library
    TestToken testToken;

    // Sample data
    bytes sampleSBE = hex"a2011901f70266555344"; // SBE encoded data
    bytes32 sampleRoot = bytes32(uint256(0x123456));
    bytes32 sampleSchemaHash = keccak256("test-dictionary");

    event FixDescriptorSet(
        bytes32 indexed fixRoot,
        bytes32 indexed schemaHash,
        address fixSBEPtr,
        uint32 fixSBELen
    );

    event FixDescriptorUpdated(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        address newPtr
    );

    function setUp() public {
        testToken = new TestToken();
    }

    function testSetDescriptor() public {
        address sbePtr = SSTORE2.write(sampleSBE);

        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: sbePtr,
            fixSBELen: uint32(sampleSBE.length),
            schemaURI: ""
        });

        // Expect FixDescriptorSet event
        vm.expectEmit(true, true, false, true);
        emit FixDescriptorSet(
            sampleRoot,
            sampleSchemaHash,
            sbePtr,
            uint32(sampleSBE.length)
        );

        testToken.setDescriptor(descriptor);

        // Verify descriptor was set
        IFixDescriptor.FixDescriptor memory stored = testToken.getDescriptor();
        assertEq(stored.schemaHash, sampleSchemaHash);
        assertEq(stored.fixRoot, sampleRoot);
        assertEq(stored.fixSBEPtr, sbePtr);
        assertEq(stored.fixSBELen, uint32(sampleSBE.length));
    }

    function testUpdateDescriptor() public {
        // Set initial descriptor
        address sbePtr1 = SSTORE2.write(sampleSBE);
        IFixDescriptor.FixDescriptor memory descriptor1 = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: sbePtr1,
            fixSBELen: uint32(sampleSBE.length),
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor1);

        // Update with new descriptor
        bytes32 newRoot = bytes32(uint256(0x654321));
        bytes memory newSBE = hex"a1011902"; 
        address sbePtr2 = SSTORE2.write(newSBE);

        IFixDescriptor.FixDescriptor memory descriptor2 = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: newRoot,
            fixSBEPtr: sbePtr2,
            fixSBELen: uint32(newSBE.length),
            schemaURI: ""
        });

        // Expect FixDescriptorUpdated event
        vm.expectEmit(true, true, false, true);
        emit FixDescriptorUpdated(sampleRoot, newRoot, sbePtr2);

        testToken.setDescriptor(descriptor2);

        // Verify descriptor was updated
        IFixDescriptor.FixDescriptor memory stored = testToken.getDescriptor();
        assertEq(stored.fixRoot, newRoot);
        assertEq(stored.fixSBEPtr, sbePtr2);
    }

    function testGetDescriptorNotInitialized() public {
        TestToken uninitializedToken = new TestToken();

        vm.expectRevert("Descriptor not initialized");
        uninitializedToken.getDescriptor();
    }

    function testGetRoot() public {
        address sbePtr = SSTORE2.write(sampleSBE);

        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: sbePtr,
            fixSBELen: uint32(sampleSBE.length),
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        bytes32 root = testToken.getRoot();
        assertEq(root, sampleRoot);
    }

    function testGetRootNotInitialized() public {
        TestToken uninitializedToken = new TestToken();

        vm.expectRevert("Descriptor not initialized");
        uninitializedToken.getRoot();
    }

    function testGetFixSBEChunk() public {
        bytes memory testData = hex"0102030405060708090a0b0c0d0e0f"; // 15 bytes
        address sbePtr = SSTORE2.write(testData);

        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: sbePtr,
            fixSBELen: uint32(testData.length),
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        // Read full chunk
        bytes memory chunk = testToken.getCBORChunk(0, 15);
        assertEq(chunk, testData);

        // Read partial chunk
        bytes memory partialChunk = testToken.getCBORChunk(5, 5);
        assertEq(partialChunk, hex"060708090a");

        // Read beyond end (should return available data)
        bytes memory overflow = testToken.getCBORChunk(10, 100);
        assertEq(overflow, hex"0b0c0d0e0f");

        // Read from beyond end (should return empty)
        bytes memory empty = testToken.getCBORChunk(100, 10);
        assertEq(empty.length, 0);
    }

    function testGetFixSBEChunkNotInitialized() public {
        TestToken uninitializedToken = new TestToken();

        vm.expectRevert("Descriptor not initialized");
        uninitializedToken.getCBORChunk(0, 10);
    }

    function testGetFixSBEChunkNoSBEDeployed() public {
        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: address(0), // No SBE deployed
            fixSBELen: 0,
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        vm.expectRevert("SBE not deployed");
        testToken.getCBORChunk(0, 10);
    }

    function testIsInitialized() public {
        assertFalse(testToken.isInitialized());

        address sbePtr = SSTORE2.write(sampleSBE);
        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: sampleRoot,
            fixSBEPtr: sbePtr,
            fixSBELen: uint32(sampleSBE.length),
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        assertTrue(testToken.isInitialized());
    }

    function testGetInterfaceId() public pure {
        bytes4 expectedId = type(IFixDescriptor).interfaceId;
        bytes4 actualId = FixDescriptorLib.getInterfaceId();
        assertEq(actualId, expectedId);
    }

    function testVerifyFieldProof() public {
        // Set up descriptor with a simple root (single leaf for simplicity)
        address sbePtr = SSTORE2.write(sampleSBE);
        
        // Create a simple merkle tree with one leaf: hash(pathCBOR || "=" || value)
        bytes memory pathCBOR = hex"01";  // Simple CBOR-encoded path
        bytes memory value = hex"37";
        bytes32 leaf = keccak256(abi.encodePacked(pathCBOR, "=", value));
        
        // For a single-leaf tree, the root IS the leaf
        bytes32 testRoot = leaf;

        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: sampleSchemaHash,
            fixRoot: testRoot,
            fixSBEPtr: sbePtr,
            fixSBELen: uint32(sampleSBE.length),
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        // Verify with empty proof (single leaf tree)
        bytes32[] memory proof = new bytes32[](0);
        bool[] memory directions = new bool[](0);

        bool result = testToken.verifyFieldProofWrapper(
            pathCBOR,
            value,
            proof,
            directions
        );

        assertTrue(result);
    }

    function testFuzzSetDescriptor(
        bytes32 schemaHash,
        bytes32 root,
        uint32 sbeLen
    ) public {
        address sbePtr = address(uint160(uint256(keccak256(abi.encodePacked(sbeLen)))));

        IFixDescriptor.FixDescriptor memory descriptor = IFixDescriptor.FixDescriptor({
            schemaHash: schemaHash,
            fixRoot: root,
            fixSBEPtr: sbePtr,
            fixSBELen: sbeLen,
            schemaURI: ""
        });

        testToken.setDescriptor(descriptor);

        IFixDescriptor.FixDescriptor memory stored = testToken.getDescriptor();
        assertEq(stored.schemaHash, schemaHash);
        assertEq(stored.fixRoot, root);
        assertEq(stored.fixSBELen, sbeLen);
    }
}

/// @title TestToken
/// @notice Simple test contract that uses FixDescriptorLib
contract TestToken {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    FixDescriptorLib.Storage private _fixDescriptor;

    function setDescriptor(IFixDescriptor.FixDescriptor calldata descriptor) external {
        _fixDescriptor.setDescriptor(descriptor);
    }

    function getDescriptor() external view returns (IFixDescriptor.FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }

    function getRoot() external view returns (bytes32) {
        return _fixDescriptor.getRoot();
    }

    function getCBORChunk(uint256 start, uint256 size) external view returns (bytes memory) {
        return _fixDescriptor.getFixSBEChunk(start, size);
    }

    function isInitialized() external view returns (bool) {
        return _fixDescriptor.isInitialized();
    }

    function verifyFieldProofWrapper(
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) external view returns (bool) {
        return _fixDescriptor.verifyFieldProof(pathCBOR, value, proof, directions);
    }
}

