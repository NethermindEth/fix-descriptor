// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IFixDescriptor.sol";
import "./FixDescriptorLib.sol";

/**
 * @title AssetTokenERC721
 * @notice Example ERC721 NFT with FIX descriptor support
 * @dev Uses FixDescriptorLib for embedded descriptor storage
 *      This example uses a single descriptor for the entire collection.
 *      For per-token descriptors, use mapping(uint256 => FixDescriptorLib.Storage)
 */
contract AssetTokenERC721 is ERC721, Ownable, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    /// @notice FIX descriptor storage for this collection
    FixDescriptorLib.Storage private _fixDescriptor;

    /// @notice Next token ID to mint
    uint256 private _nextTokenId;

    /**
     * @notice Constructor
     * @param name Token name
     * @param symbol Token symbol
     */
    constructor(
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) Ownable(msg.sender) {}

    /**
     * @notice Mint a new token
     * @param to Address to mint to
     * @return tokenId The minted token ID
     */
    function mint(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    /**
     * @notice Set the FIX descriptor for this collection
     * @dev Can only be called by owner
     * @param descriptor The complete FixDescriptor struct
     */
    function setFixDescriptor(FixDescriptor calldata descriptor) external onlyOwner {
        _fixDescriptor.setDescriptor(descriptor);
    }

    /**
     * @inheritdoc IFixDescriptor
     */
    function getFixDescriptor() external view override returns (FixDescriptor memory) {
        return _fixDescriptor.getDescriptor();
    }

    /**
     * @inheritdoc IFixDescriptor
     */
    function getFixRoot() external view override returns (bytes32) {
        return _fixDescriptor.getRoot();
    }

    /**
     * @inheritdoc IFixDescriptor
     */
    function verifyField(
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) external view override returns (bool) {
        return _fixDescriptor.verifyFieldProof(pathCBOR, value, proof, directions);
    }

    /**
     * @notice Get SBE data chunk
     * @param start Start offset (in the data, not including STOP byte)
     * @param size Number of bytes to read
     * @return chunk The requested SBE data
     */
    function getFixSBEChunk(uint256 start, uint256 size)
        external
        view
        returns (bytes memory chunk)
    {
        return _fixDescriptor.getFixSBEChunk(start, size);
    }

    /**
     * @inheritdoc IFixDescriptor
     */
    function getDescriptorEngine() external view override returns (address engine) {
        return address(0); // Not using engine pattern
    }

    /**
     * @inheritdoc ERC165
     */
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        virtual 
        override(ERC721) 
        returns (bool) 
    {
        return interfaceId == FixDescriptorLib.getInterfaceId() || 
               super.supportsInterface(interfaceId);
    }
}
