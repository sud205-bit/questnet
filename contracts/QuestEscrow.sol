// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title QuestEscrow
 * @notice Escrow contract for QuestNet — the AI agent work marketplace.
 *         Posters deposit USDC bounties on quest creation.
 *         On completion, the resolver (QuestNet backend) releases funds:
 *           - 97.5% → completing agent wallet
 *           - 2.5%  → QuestNet treasury wallet
 *         Posters can refund cancelled quests before release.
 *
 *         v2: Adds EIP-712 proof-of-delivery (completeWithProof) so agents can
 *             trigger trustless payout without the resolver. The resolver's
 *             release() remains as a fallback.
 *
 * @dev Deployed on Base mainnet.
 *      USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */
contract QuestEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant FEE_BPS = 250;      // 2.5% = 250 basis points
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ── EIP-712 Proof-of-Delivery ─────────────────────────────────────────────
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant DELIVERY_TYPEHASH = keccak256(
        "Delivery(uint256 questId,bytes32 deliverableHash,address agentWallet,uint256 deadline)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── State ─────────────────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public treasury;
    address public resolver;    // QuestNet backend wallet — can release/refund and register agents

    struct Escrow {
        address poster;         // who deposited (must be the refund recipient)
        uint256 amount;         // USDC amount (6 decimals), 0 once settled
        bool    settled;        // true once released or refunded
    }

    // questId (off-chain DB id, uint256) → Escrow
    mapping(uint256 => Escrow) public escrows;

    // Track registered agents — only registered agent wallets can use completeWithProof
    mapping(address => bool) public registeredAgents;

    // ── Events ────────────────────────────────────────────────────────────────
    event Deposited(uint256 indexed questId, address indexed poster, uint256 amount);
    event Released(uint256 indexed questId, address indexed agent, uint256 agentAmount, uint256 feeAmount);
    event Refunded(uint256 indexed questId, address indexed poster, uint256 amount);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event DeliveryProofSubmitted(uint256 indexed questId, bytes32 deliverableHash, address indexed agent);
    event AgentRegistered(address indexed agentWallet);

    // ── Errors ────────────────────────────────────────────────────────────────
    error NotResolver();
    error QuestAlreadyExists(uint256 questId);
    error QuestNotFound(uint256 questId);
    error QuestAlreadySettled(uint256 questId);
    error ZeroAddress();
    error ZeroAmount();
    error InvalidAgent();
    error DeadlineExpired();
    error InvalidSignature();
    error AgentNotRegistered();
    error DeliverableHashMissing();

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _usdc,
        address _treasury,
        address _resolver
    ) Ownable(msg.sender) {
        if (_usdc == address(0) || _treasury == address(0) || _resolver == address(0))
            revert ZeroAddress();
        usdc     = IERC20(_usdc);
        treasury = _treasury;
        resolver = _resolver;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("QuestNet"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Poster deposits USDC bounty to lock it in escrow for a quest.
     * @dev    The poster must have approved this contract for at least `amount` USDC.
     *         Call this once per quest. questId must be unique (matches DB id).
     * @param  questId  Off-chain quest ID (matches Turso DB quests.id)
     * @param  amount   Bounty in USDC (6 decimals — e.g. 100 USDC = 100_000_000)
     */
    function deposit(uint256 questId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (escrows[questId].amount != 0 || escrows[questId].settled) revert QuestAlreadyExists(questId);

        escrows[questId] = Escrow({
            poster:  msg.sender,
            amount:  amount,
            settled: false
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(questId, msg.sender, amount);
    }

    /**
     * @notice Resolver releases bounty to completing agent and takes 2.5% fee.
     * @dev    Only callable by `resolver` (QuestNet backend wallet).
     *         Splits atomically: 97.5% → agent, 2.5% → treasury.
     *         Serves as fallback when completeWithProof is not used.
     * @param  questId     Quest to settle
     * @param  agentWallet Wallet address of the completing agent
     */
    function release(uint256 questId, address agentWallet) external nonReentrant onlyResolver {
        if (agentWallet == address(0)) revert InvalidAgent();

        Escrow storage e = escrows[questId];
        if (e.amount == 0 && !e.settled) revert QuestNotFound(questId);
        if (e.settled) revert QuestAlreadySettled(questId);

        uint256 totalAmount = e.amount;
        e.settled = true;
        e.amount  = 0;

        // Calculate splits
        uint256 feeAmount   = (totalAmount * FEE_BPS) / BPS_DENOMINATOR;   // 2.5%
        uint256 agentAmount = totalAmount - feeAmount;                       // 97.5%

        // Transfer atomically
        usdc.safeTransfer(agentWallet, agentAmount);
        usdc.safeTransfer(treasury, feeAmount);

        emit Released(questId, agentWallet, agentAmount, feeAmount);
    }

    /**
     * @notice Resolver refunds the full bounty to the original poster (quest cancelled).
     * @dev    Only callable by `resolver`. Poster gets 100% back.
     * @param  questId Quest to cancel
     */
    function refund(uint256 questId) external nonReentrant onlyResolver {
        Escrow storage e = escrows[questId];
        if (e.amount == 0 && !e.settled) revert QuestNotFound(questId);
        if (e.settled) revert QuestAlreadySettled(questId);

        address poster    = e.poster;
        uint256 amount    = e.amount;
        e.settled = true;
        e.amount  = 0;

        usdc.safeTransfer(poster, amount);

        emit Refunded(questId, poster, amount);
    }

    // ── Proof-of-Delivery ─────────────────────────────────────────────────────

    /**
     * @notice Register an agent wallet as authorized for proof-of-delivery.
     * @dev    Only resolver can register agents (maps to DB agent registration).
     * @param agentWallet  The agent wallet to authorize
     */
    function registerAgent(address agentWallet) external onlyResolver {
        if (agentWallet == address(0)) revert ZeroAddress();
        registeredAgents[agentWallet] = true;
        emit AgentRegistered(agentWallet);
    }

    /**
     * @notice Trustless quest completion via cryptographic proof of delivery.
     * @dev    Agent signs { questId, deliverableHash, agentWallet, deadline } off-chain
     *         using EIP-712. Anyone can submit this signature on-chain — the contract
     *         verifies and releases atomically. No resolver needed.
     *         Eliminates subjective approval for deterministic deliverables.
     *
     *         The resolver's release() remains available as a fallback for dispute
     *         resolution or cases where the agent is not registered.
     *
     * @param questId          The quest being completed
     * @param deliverableHash  keccak256 of the deliverable content (IPFS CID, JSON, etc.)
     * @param agentWallet      The completing agent's wallet (must be registered, receives payout)
     * @param deadline         Unix timestamp — signature expires after this
     * @param signature        65-byte EIP-712 signature from agentWallet
     */
    function completeWithProof(
        uint256 questId,
        bytes32 deliverableHash,
        address agentWallet,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (agentWallet == address(0)) revert InvalidAgent();
        if (deliverableHash == bytes32(0)) revert DeliverableHashMissing();
        if (!registeredAgents[agentWallet]) revert AgentNotRegistered();

        // Verify EIP-712 signature — agent must have signed this exact struct
        bytes32 structHash = keccak256(abi.encode(
            DELIVERY_TYPEHASH,
            questId,
            deliverableHash,
            agentWallet,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = _recoverSigner(digest, signature);
        if (signer != agentWallet) revert InvalidSignature();

        // Release escrow
        Escrow storage e = escrows[questId];
        if (e.amount == 0 && !e.settled) revert QuestNotFound(questId);
        if (e.settled) revert QuestAlreadySettled(questId);

        uint256 totalAmount = e.amount;
        e.settled = true;
        e.amount  = 0;

        uint256 feeAmount   = (totalAmount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 agentAmount = totalAmount - feeAmount;

        usdc.safeTransfer(agentWallet, agentAmount);
        usdc.safeTransfer(treasury, feeAmount);

        emit DeliveryProofSubmitted(questId, deliverableHash, agentWallet);
        emit Released(questId, agentWallet, agentAmount, feeAmount);
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

    // ── View Functions ────────────────────────────────────────────────────────

    /**
     * @notice Returns escrow details for a quest.
     */
    function getEscrow(uint256 questId) external view returns (
        address poster,
        uint256 amount,
        bool settled
    ) {
        Escrow storage e = escrows[questId];
        return (e.poster, e.amount, e.settled);
    }

    /**
     * @notice Preview the fee and agent payout for a given bounty amount.
     */
    function previewSplit(uint256 amount) external pure returns (uint256 agentAmount, uint256 feeAmount) {
        feeAmount   = (amount * FEE_BPS) / BPS_DENOMINATOR;
        agentAmount = amount - feeAmount;
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /**
     * @notice Update the resolver address (e.g. rotate backend wallet).
     */
    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    /**
     * @notice Update the treasury address.
     */
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }
}
