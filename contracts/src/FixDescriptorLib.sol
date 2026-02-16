// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFixDescriptor.sol";
import "./FixMerkleVerifier.sol";

/**
 * @title FixDescriptorLib
 * @notice Library for managing FIX descriptors in token contracts
 * @dev Use this library to add FIX descriptor functionality to any token (ERC20, ERC721, etc.)
 *      with minimal boilerplate. Compatible with upgradeable and non-upgradeable patterns.
 * 
 * Usage:
 *   using FixDescriptorLib for FixDescriptorLib.Storage;
 *   FixDescriptorLib.Storage private _fixDescriptor;
 * 
 * Then forward IFixDescriptor interface calls to the storage instance:
 *   function getFixDescriptor() external view returns (FixDescriptor memory) {
 *       return _fixDescriptor.getDescriptor();
 *   }
 */
library FixDescriptorLib {
    
    /**
     * @notice Storage struct for FIX descriptor state
     * @dev Use this as a state variable in your token contract
     */
    struct Storage {
        IFixDescriptor.FixDescriptor descriptor;
        bool initialized;
    }

    /**
     * @notice Set or update the FIX descriptor
     * @dev Emits appropriate event based on whether this is first initialization or update
     *      This function does NOT enforce access control - wrap it in your contract with 
     *      onlyOwner or other modifiers as needed
     * @param self Storage reference
     * @param descriptor The complete FixDescriptor struct
     */
    function setDescriptor(
        Storage storage self,
        IFixDescriptor.FixDescriptor memory descriptor
    ) internal {
        bytes32 oldRoot = self.descriptor.fixRoot;
        self.descriptor = descriptor;

        if (self.initialized) {
            emit IFixDescriptor.FixDescriptorUpdated(
                oldRoot,
                descriptor.fixRoot,
                descriptor.fixSBEPtr
            );
        } else {
            emit IFixDescriptor.FixDescriptorSet(
                descriptor.fixRoot,
                descriptor.schemaHash,
                descriptor.fixSBEPtr,
                descriptor.fixSBELen
            );
            self.initialized = true;
        }
    }

    /**
     * @notice Get the complete FIX descriptor
     * @param self Storage reference
     * @return descriptor The FixDescriptor struct
     */
    function getDescriptor(Storage storage self)
        internal
        view
        returns (IFixDescriptor.FixDescriptor memory descriptor)
    {
        require(self.initialized, "Descriptor not initialized");
        return self.descriptor;
    }

    /**
     * @notice Get the Merkle root commitment
     * @param self Storage reference
     * @return root The fixRoot for verification
     */
    function getRoot(Storage storage self)
        internal
        view
        returns (bytes32 root)
    {
        require(self.initialized, "Descriptor not initialized");
        return self.descriptor.fixRoot;
    }

    /**
     * @notice Verify a specific field against the committed descriptor
     * @param self Storage reference
     * @param pathCBOR CBOR-encoded bytes of the field path
     * @param value Raw FIX value bytes
     * @param proof Merkle proof (sibling hashes)
     * @param directions Direction array (true=right child, false=left child)
     * @return valid True if the proof is valid
     */
    function verifyFieldProof(
        Storage storage self,
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) internal view returns (bool valid) {
        require(self.initialized, "Descriptor not initialized");
        return FixMerkleVerifier.verify(
            self.descriptor.fixRoot,
            pathCBOR,
            value,
            proof,
            directions
        );
    }

    /**
     * @notice Get SBE data chunk from SSTORE2 storage
     * @dev Handles all the complexity of reading from SSTORE2 contract bytecode
     *      including the STOP byte offset and range validation
     * @param self Storage reference
     * @param start Start offset (in the data, not including STOP byte)
     * @param size Number of bytes to read
     * @return chunk The requested SBE data
     */
    function getFixSBEChunk(
        Storage storage self,
        uint256 start,
        uint256 size
    ) internal view returns (bytes memory chunk) {
        require(self.initialized, "Descriptor not initialized");
        require(self.descriptor.fixSBEPtr != address(0), "SBE not deployed");

        address ptr = self.descriptor.fixSBEPtr;

        // Get code size using extcodesize
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(ptr)
        }

        require(codeSize > 0, "No SBE data");

        // Data starts at byte 1 (after STOP byte at position 0)
        // Data length is codeSize - 1
        uint256 dataLength = codeSize - 1;

        // Validate and adjust range
        if (start >= dataLength) {
            return new bytes(0);
        }

        uint256 end = start + size;
        if (end > dataLength) {
            end = dataLength;
        }

        uint256 actualSize = end - start;

        // Use extcodecopy to read directly from contract bytecode
        // Add 1 to start to skip the STOP byte (data begins at position 1)
        chunk = new bytes(actualSize);
        assembly {
            extcodecopy(ptr, add(chunk, 0x20), add(start, 1), actualSize)
        }
    }

    /**
     * @notice Check if descriptor has been initialized
     * @param self Storage reference
     * @return True if descriptor is initialized
     */
    function isInitialized(Storage storage self)
        internal
        view
        returns (bool)
    {
        return self.initialized;
    }

    /**
     * @notice Get the ERC165 interface ID for IFixDescriptor
     * @return interfaceId The interface ID
     */
    function getInterfaceId() internal pure returns (bytes4 interfaceId) {
        return type(IFixDescriptor).interfaceId;
    }
}

