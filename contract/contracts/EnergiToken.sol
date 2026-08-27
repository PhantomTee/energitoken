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
    /// In production this is a server-side oracle (see app/api/oracle/*.ts
    /// and app/api/payments/*.ts in this repo) that watches Flutterwave
    /// payment confirmations and ESP32 meter consumption reports. This
    /// contract only exposes the on-chain interface it calls into:
    ///   - on a confirmed payment of N watt-hours: oracle calls mint(buyer, N)
    ///   - on the meter reporting N watt-hours consumed: oracle calls burnConsumed(holder, N)
    address public oracle;

    /// @notice Energy already consumed (per the meter) but not yet burned
    /// on-chain, in watt-hours. Kept current by the oracle calling
    /// setPendingBurn every few minutes. This is what closes the double-spend
    /// gap: without it, a household could transfer away their full on-chain
    /// balance right after using electricity but before the next burn batch,
    /// getting the electricity for free. See spendableBalanceOf and the
    /// _update override below for the enforcement.
    mapping(address => uint256) public pendingBurn;

    event Minted(address indexed to, uint256 wh);
    event Consumed(address indexed from, uint256 wh);
    event OracleUpdated(address indexed newOracle);
    event PendingBurnUpdated(address indexed user, uint256 wh);

    /// @notice Thrown when a transfer would leave the sender with less than
    /// their pendingBurn amount -- they can't give away energy they've
    /// already used but the chain hasn't deducted yet.
    error SpendableBalanceExceeded(address account, uint256 requested, uint256 spendable);

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
    /// Resets pendingBurn to zero -- this consumption is now settled on-chain.
    function burnConsumed(address from, uint256 wh) external onlyOracle {
        _burn(from, wh);
        pendingBurn[from] = 0;
        emit Consumed(from, wh);
    }

    /// @notice Called by the oracle every few minutes with the household's
    /// total consumption since the last burn, so transfers can be capped
    /// against it in between burn batches. Sets (does not add to) the
    /// figure, so it's safe to call repeatedly with a freshly-computed total.
    function setPendingBurn(address user, uint256 amount) external onlyOracle {
        pendingBurn[user] = amount;
        emit PendingBurnUpdated(user, amount);
    }

    /// @notice What this user can actually transfer right now: their on-chain
    /// balance minus energy already used but not yet burned. This is the
    /// figure the app should show and cap transfers against, and the figure
    /// the contract itself enforces in _update below.
    function spendableBalanceOf(address user) public view returns (uint256) {
        uint256 bal = balanceOf(user);
        uint256 pending = pendingBurn[user];
        if (pending >= bal) return 0;
        return bal - pending;
    }

    /// @notice Rotates the oracle address, e.g. if the off-chain service key is replaced.
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "EnergiToken: oracle is zero address");
        oracle = newOracle;
        emit OracleUpdated(newOracle);
    }

    /// @dev OpenZeppelin v5's single transfer/mint/burn hook. Only guard the
    /// user-to-user case (both addresses non-zero) -- mint (from == 0) and
    /// burn (to == 0) must never be blocked by this, since burnConsumed
    /// itself needs to reduce a balance below what pendingBurn currently says
    /// (that's the whole point of burning it).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 spendable = spendableBalanceOf(from);
            if (value > spendable) {
                revert SpendableBalanceExceeded(from, value, spendable);
            }
        }
        super._update(from, to, value);
    }
}
