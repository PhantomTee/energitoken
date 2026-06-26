// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title EnergiToken (ENGY)
/// @notice Represents prepaid household electricity credit, 1 token = 1 watt-hour.
/// Minted when a prepayment is confirmed, burned as the household's smart meter
/// reports consumption, and freely transferable peer-to-peer for surplus sharing.
contract EnergiToken is ERC20, Ownable {
    /// @notice The only address allowed to mint or burn tokens.
    /// In production this is a server-side oracle that watches OPay payment
    /// confirmations and ESP32 meter consumption reports — that oracle is
    /// out of scope for this repository. This contract only exposes the
    /// on-chain interface it calls into:
    ///   - on a confirmed payment of N watt-hours: oracle calls mint(buyer, N)
    ///   - on the meter reporting N watt-hours consumed: oracle calls burnConsumed(holder, N)
    address public oracle;

    event Minted(address indexed to, uint256 wh);
    event Consumed(address indexed from, uint256 wh);
    event OracleUpdated(address indexed newOracle);

    modifier onlyOracle() {
        require(msg.sender == oracle, "EnergiToken: caller is not the oracle");
        _;
    }

    constructor(address initialOracle) ERC20("EnergiToken", "ENGY") Ownable(msg.sender) {
        require(initialOracle != address(0), "EnergiToken: oracle is zero address");
        oracle = initialOracle;
    }

    /// @notice Whole watt-hours only — fractional energy credit has no meaning here.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Called by the oracle when a prepayment for `wh` watt-hours is confirmed.
    function mint(address to, uint256 wh) external onlyOracle {
        _mint(to, wh);
        emit Minted(to, wh);
    }

    /// @notice Called by the oracle when the household's meter reports `wh` watt-hours consumed.
    function burnConsumed(address from, uint256 wh) external onlyOracle {
        _burn(from, wh);
        emit Consumed(from, wh);
    }

    /// @notice Rotates the oracle address, e.g. if the off-chain service key is replaced.
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "EnergiToken: oracle is zero address");
        oracle = newOracle;
        emit OracleUpdated(newOracle);
    }
}
