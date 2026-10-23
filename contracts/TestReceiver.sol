// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC721Like { function transferFrom(address, address, uint256) external; }

/// @notice Test helper (not production code): a non-owner receiver that, inside onERC721Received,
/// forwards the just-received token to `sink` using the token contract's public transferFrom.
contract TestReceiver {
    address public sink;
    constructor(address sink_) { sink = sink_; }
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        IERC721Like(msg.sender).transferFrom(address(this), sink, tokenId);
        return this.onERC721Received.selector;
    }
}
