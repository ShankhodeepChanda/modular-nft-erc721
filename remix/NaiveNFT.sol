// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Illustrative hand-written ERC-721 baseline (NOT production code).
/// It deliberately contains the defect classes discussed in the paper:
/// unrestricted minting, a publicly callable burn, and per-token URI storage.
contract NaiveNFT {
    string public name = "NaiveNFT";
    string public symbol = "NNFT";

    uint256 private _nextId;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(uint256 => string) private _uris;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    function balanceOf(address a) external view returns (uint256) { return _balances[a]; }
    function ownerOf(uint256 id) public view returns (address o) {
        o = _owners[id];
        require(o != address(0), "nonexistent");
    }
    function tokenURI(uint256 id) external view returns (string memory) { return _uris[id]; }

    // DEFECT 1: anyone can mint, with no supply cap.
    function mint(address to, string calldata uri) public returns (uint256 id) {
        require(to != address(0), "zero address");
        id = _nextId++;
        _owners[id] = to;
        _balances[to] += 1;
        _uris[id] = uri;
        emit Transfer(address(0), to, id);
    }

    // DEFECT 2: anyone can burn any token (no ownership/approval check).
    function burn(uint256 id) public {
        address o = ownerOf(id);
        delete _owners[id];
        delete _approved[id];
        delete _uris[id];
        _balances[o] -= 1;
        emit Transfer(o, address(0), id);
    }

    function approve(address to, uint256 id) external {
        require(msg.sender == ownerOf(id), "not owner");
        _approved[id] = to;
        emit Approval(msg.sender, to, id);
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(ownerOf(id) == from, "wrong owner");
        require(to != address(0), "zero address");
        require(msg.sender == from || msg.sender == _approved[id], "not authorized");
        delete _approved[id];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[id] = to;
        emit Transfer(from, to, id);
    }
}
