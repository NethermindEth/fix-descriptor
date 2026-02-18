// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./IFixDescriptor.sol";
import "./FixDescriptorLib.sol";

/**
 * @title AssetTokenERC20
 * @notice Example ERC20 token with FIX descriptor support
 * @dev Uses FixDescriptorLib for embedded descriptor storage
 */
contract AssetTokenERC20 is ERC20, Ownable, ERC165, IFixDescriptor {
    using FixDescriptorLib for FixDescriptorLib.Storage;

    /// @notice FIX descriptor storage
    FixDescriptorLib.Storage private _fixDescriptor;

    /**
     * @notice Constructor
     * @param name Token name
     * @param symbol Token symbol
     * @param initialSupply Initial token supply
     * @param initialOwner Address to receive initial supply and ownership
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _mint(initialOwner, initialSupply);
    }

    /**
     * @notice Set the FIX descriptor for this asset
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
        override(ERC165) 
        returns (bool) 
    {
        return interfaceId == FixDescriptorLib.getInterfaceId() || 
               super.supportsInterface(interfaceId);
    }
}
