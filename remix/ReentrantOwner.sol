// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test helper: acts as the contract owner and, inside onERC721Received,
/// calls the same mint function again (a reentrancy attempt).
contract ReentrantOwner {
    address public target;
    bytes public data;
    bool public entered;

    function attack(address t, bytes calldata d) external {
        target = t;
        data = d;
        (bool ok, bytes memory ret) = t.call(d);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!entered) {
            entered = true;
            (bool ok, bytes memory ret) = target.call(data);
            if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
        }
        return this.onERC721Received.selector;
    }
}
