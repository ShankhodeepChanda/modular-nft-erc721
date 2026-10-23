// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
/// Owner-proxy used for the "ten sequential single mints inside ONE transaction" workload.
contract Looper {
    function run(address target, address to, uint256 n) external {
        for (uint256 i; i < n; ) {
            (bool ok, bytes memory r) = target.call(abi.encodeWithSignature("mint(address)", to));
            if (!ok) { assembly { revert(add(r, 32), mload(r)) } }
            unchecked { ++i; }
        }
    }
}
