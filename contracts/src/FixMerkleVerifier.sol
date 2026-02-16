// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library FixMerkleVerifier {
    /// @notice Verify a FIX field against a FixDescriptor's Merkle root.
    /// @param root      The fixRoot stored onchain.
    /// @param pathCBOR  CBOR-encoded bytes of the path array (e.g., [454,1,456]).
    /// @param value     Raw FIX value bytes (UTF-8), exactly as used in SBE.
    /// @param proof     Sibling hashes bottom-up.
    /// @param directions Direction bits: false=current is left child; true=current is right child.
    /// @return ok       True if proof is valid and binds (path,value) to root.
    function verify(
        bytes32 root,
        bytes memory pathCBOR,
        bytes memory value,
        bytes32[] memory proof,
        bool[] memory directions
    ) internal pure returns (bool ok) {
        bytes32 node = keccak256(abi.encodePacked(pathCBOR, "=", value));
        uint256 len = proof.length;
        for (uint256 i = 0; i < len; i++) {
            bytes32 sib = proof[i];
            if (directions[i]) {
                // current is right child: parent = keccak(sib || node)
                node = keccak256(abi.encodePacked(sib, node));
            } else {
                // current is left child: parent = keccak(node || sib)
                node = keccak256(abi.encodePacked(node, sib));
            }
        }
        return node == root;
    }
}

contract FixMerkleVerifierHarness {
    function verifyField(
        bytes32 root,
        bytes calldata pathCBOR,
        bytes calldata value,
        bytes32[] calldata proof,
        bool[] calldata directions
    ) external pure returns (bool) {
        return FixMerkleVerifier.verify(root, pathCBOR, value, proof, directions);
    }
}


