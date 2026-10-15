// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts@5.0.2/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts@5.0.2/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";

/// @notice Proposed modular ERC-721: owner-only mint, immutable supply cap, shared base URI
/// (no per-token URI storage), batch minting, pausable minting, reentrancy guard,
/// and authorization-checked burn.
contract ModularNFT is ERC721, Ownable, Pausable, ReentrancyGuard {
    error MaxSupplyReached();
    error ZeroQuantity();

    uint256 public immutable MAX_SUPPLY;
    uint256 private _nextId;
    string private _baseTokenURI;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        address owner_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        _baseTokenURI = baseURI_;
        MAX_SUPPLY = maxSupply_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function totalMinted() external view returns (uint256) {
        return _nextId;
    }

    function mint(address to) external onlyOwner whenNotPaused nonReentrant returns (uint256 id) {
        id = _nextId;
        if (id >= MAX_SUPPLY) revert MaxSupplyReached();
        unchecked { _nextId = id + 1; }
        _safeMint(to, id);
    }

    function mintBatch(address to, uint256 qty) external onlyOwner whenNotPaused nonReentrant {
        if (qty == 0) revert ZeroQuantity();
        uint256 start = _nextId;
        if (start + qty > MAX_SUPPLY) revert MaxSupplyReached();
        unchecked { _nextId = start + qty; }
        for (uint256 i; i < qty; ) {
            _safeMint(to, start + i);
            unchecked { ++i; }
        }
    }

    /// @dev Only the token owner or an approved operator may burn.
    function burn(uint256 id) external {
        _update(address(0), id, _msgSender());
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
