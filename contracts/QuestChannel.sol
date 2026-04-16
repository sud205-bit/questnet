// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title QuestChannel
 * @notice Off-chain payment channels for high-frequency agent micro-tasks.
 *         Eliminates per-task on-chain latency — agents exchange signed
 *         vouchers off-chain and settle the net on-chain when done.
 *
 * Flow:
 *   1. Poster calls openChannel(agent, totalBudget, expiryTime)
 *   2. Agent and poster exchange signed Voucher structs off-chain for each micro-task
 *   3. Either party calls closeChannel(channelId, cumulativeAmount, nonce, sig) to settle
 *   4. Agent gets cumulativeAmount minus 2.5% fee; poster gets remainder
 *   5. If channel expires unclosed, poster calls reclaimExpired() to recover deposit
 *
 * Voucher signing (off-chain):
 *   The poster signs Voucher { channelId, cumulativeAmount, nonce } using EIP-712.
 *   Nonces must be monotonically increasing to prevent replay of earlier (lower) amounts.
 *   The latest valid poster-signed voucher is always the one to submit at close.
 *
 * Fee model:
 *   2.5% of agentEarned goes to QuestNet treasury.
 *   Remainder of the deposit is refunded to poster.
 *
 * @dev Deployed alongside QuestEscrow on Base mainnet.
 *      USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */
contract QuestChannel is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant FEE_BPS = 250;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ── State ─────────────────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public treasury;

    struct Channel {
        address poster;
        address agent;
        uint256 totalDeposit;   // USDC locked (6 decimals)
        uint256 expiry;         // unix timestamp — poster can reclaim after
        bool    settled;
    }

    // channelId → Channel
    mapping(bytes32 => Channel) public channels;

    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 channelId,uint256 cumulativeAmount,uint256 nonce)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── Events ────────────────────────────────────────────────────────────────
    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed poster,
        address indexed agent,
        uint256 amount,
        uint256 expiry
    );
    event ChannelClosed(
        bytes32 indexed channelId,
        address indexed agent,
        uint256 agentAmount,
        uint256 posterRefund
    );
    event ChannelExpired(
        bytes32 indexed channelId,
        address indexed poster,
        uint256 refund
    );

    // ── Errors ────────────────────────────────────────────────────────────────
    error ChannelAlreadyExists();
    error ChannelNotFound();
    error ChannelAlreadySettled();
    error ChannelExpiredError();
    error ChannelNotExpired();
    error InvalidVoucherSignature();
    error AmountExceedsDeposit();
    error ZeroAddress();
    error ZeroAmount();
    error OnlyPoster();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _usdc, address _treasury) {
        if (_usdc == address(0) || _treasury == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        treasury = _treasury;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("QuestChannel"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Poster opens a payment channel with an agent.
     * @dev    Transfers `amount` USDC from poster into escrow. The returned
     *         channelId is deterministic from (poster, agent, timestamp, chainId)
     *         and must be used in all subsequent off-chain vouchers.
     *
     * @param agent       Agent wallet address
     * @param amount      Total USDC budget for the channel session (6 decimals)
     * @param expiryTime  Channel expires at this unix timestamp
     * @return channelId  Unique channel identifier (embed in all vouchers)
     */
    function openChannel(
        address agent,
        uint256 amount,
        uint256 expiryTime
    ) external nonReentrant returns (bytes32 channelId) {
        if (agent == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        channelId = keccak256(abi.encodePacked(msg.sender, agent, block.timestamp, block.chainid));
        if (channels[channelId].totalDeposit != 0) revert ChannelAlreadyExists();

        channels[channelId] = Channel({
            poster:       msg.sender,
            agent:        agent,
            totalDeposit: amount,
            expiry:       expiryTime,
            settled:      false
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ChannelOpened(channelId, msg.sender, agent, amount, expiryTime);
    }

    /**
     * @notice Close channel and settle using the poster's latest signed voucher.
     * @dev    The poster signs Voucher { channelId, cumulativeAmount, nonce } off-chain.
     *         Anyone may call this — only the signature matters.
     *         nonce should be the highest nonce the poster signed, preventing
     *         submission of a stale (lower-value) voucher.
     *
     *         Splits on close:
     *           agentEarned × 97.5% → agent
     *           agentEarned ×  2.5% → treasury
     *           (totalDeposit − agentEarned) → poster
     *
     * @param channelId        Channel to close
     * @param cumulativeAmount Total USDC earned by agent across all micro-tasks
     * @param nonce            Monotonically increasing nonce from the poster's latest voucher
     * @param posterSig        65-byte EIP-712 signature from poster approving this amount
     */
    function closeChannel(
        bytes32 channelId,
        uint256 cumulativeAmount,
        uint256 nonce,
        bytes calldata posterSig
    ) external nonReentrant {
        Channel storage c = channels[channelId];
        if (c.totalDeposit == 0) revert ChannelNotFound();
        if (c.settled) revert ChannelAlreadySettled();
        if (block.timestamp > c.expiry) revert ChannelExpiredError();
        if (cumulativeAmount > c.totalDeposit) revert AmountExceedsDeposit();

        // Verify poster signed this voucher
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            channelId,
            cumulativeAmount,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = _recoverSigner(digest, posterSig);
        if (signer != c.poster) revert InvalidVoucherSignature();

        _settle(channelId, c, cumulativeAmount);
    }

    /**
     * @notice Poster reclaims the full deposit after channel expires unclosed.
     * @dev    Only callable by the poster. Channel must be past its expiry timestamp.
     * @param channelId  Channel to reclaim
     */
    function reclaimExpired(bytes32 channelId) external nonReentrant {
        Channel storage c = channels[channelId];
        if (c.totalDeposit == 0) revert ChannelNotFound();
        if (c.settled) revert ChannelAlreadySettled();
        if (block.timestamp <= c.expiry) revert ChannelNotExpired();
        if (msg.sender != c.poster) revert OnlyPoster();

        uint256 refund = c.totalDeposit;
        c.settled = true;
        c.totalDeposit = 0;

        usdc.safeTransfer(c.poster, refund);
        emit ChannelExpired(channelId, c.poster, refund);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /**
     * @notice Returns channel details.
     */
    function getChannel(bytes32 channelId) external view returns (
        address poster,
        address agent,
        uint256 totalDeposit,
        uint256 expiry,
        bool settled
    ) {
        Channel storage c = channels[channelId];
        return (c.poster, c.agent, c.totalDeposit, c.expiry, c.settled);
    }

    /**
     * @notice Preview the three-way split for a given earned amount and total deposit.
     * @param agentEarned   Cumulative amount earned by the agent
     * @param totalDeposit  Total deposit locked in the channel
     */
    function previewSplit(
        uint256 agentEarned,
        uint256 totalDeposit
    ) external pure returns (
        uint256 agentAmount,
        uint256 feeAmount,
        uint256 posterRefund
    ) {
        feeAmount    = (agentEarned * FEE_BPS) / BPS_DENOMINATOR;
        agentAmount  = agentEarned - feeAmount;
        posterRefund = totalDeposit - agentEarned;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _settle(bytes32 channelId, Channel storage c, uint256 agentEarned) internal {
        uint256 totalDeposit = c.totalDeposit;
        c.settled = true;
        c.totalDeposit = 0;

        uint256 feeAmount    = (agentEarned * FEE_BPS) / BPS_DENOMINATOR;
        uint256 agentAmount  = agentEarned - feeAmount;
        uint256 posterRefund = totalDeposit - agentEarned;

        if (agentAmount > 0)  usdc.safeTransfer(c.agent,    agentAmount);
        if (feeAmount > 0)    usdc.safeTransfer(treasury,   feeAmount);
        if (posterRefund > 0) usdc.safeTransfer(c.poster,   posterRefund);

        emit ChannelClosed(channelId, c.agent, agentAmount, posterRefund);
    }

    /**
     * @dev Recover signer address from a digest and compact 65-byte signature.
     */
    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}
