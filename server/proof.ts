// server/proof.ts
// Cryptographic proof-of-delivery for trustless quest completion.
// Agent signs a delivery struct off-chain; backend verifies and triggers escrow release.

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters, recoverAddress, hashMessage } from "viem";
import { base } from "viem/chains";

const DELIVERY_TYPEHASH = keccak256(
  Buffer.from("Delivery(uint256 questId,bytes32 deliverableHash,address agentWallet,uint256 deadline)")
);

// EIP-712 domain for QuestEscrow — must match the deployed contract
const DOMAIN = {
  name: "QuestNet",
  version: "1",
  chainId: BigInt(8453), // Base mainnet
  verifyingContract: (process.env.ESCROW_CONTRACT_ADDRESS ?? "") as `0x${string}`,
};

export interface DeliveryProof {
  questId: number;
  deliverableHash: string;   // keccak256 of deliverable content, as 0x hex string
  agentWallet: string;       // 0x agent wallet
  deadline: number;          // unix timestamp
  signature: string;         // EIP-712 signature, 0x hex
}

export interface ProofVerification {
  valid: boolean;
  error?: string;
  signer?: string;
}

/**
 * Verify a proof-of-delivery signature off-chain (mirrors the Solidity logic).
 * Used by the backend to validate before calling completeWithProof on-chain.
 */
export async function verifyDeliveryProof(proof: DeliveryProof): Promise<ProofVerification> {
  try {
    if (Date.now() / 1000 > proof.deadline) {
      return { valid: false, error: "Proof deadline has expired" };
    }

    // Compute EIP-712 struct hash
    const structHash = keccak256(encodeAbiParameters(
      parseAbiParameters("bytes32, uint256, bytes32, address, uint256"),
      [
        DELIVERY_TYPEHASH,
        BigInt(proof.questId),
        proof.deliverableHash as `0x${string}`,
        proof.agentWallet as `0x${string}`,
        BigInt(proof.deadline),
      ]
    ));

    // Compute domain separator (must match contract)
    const domainHash = keccak256(encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
      [
        keccak256(Buffer.from("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(Buffer.from("QuestNet")),
        keccak256(Buffer.from("1")),
        BigInt(8453),
        DOMAIN.verifyingContract,
      ]
    ));

    // EIP-712 digest
    const digest = keccak256(
      Buffer.concat([
        Buffer.from("1901", "hex"),
        Buffer.from(domainHash.slice(2), "hex"),
        Buffer.from(structHash.slice(2), "hex"),
      ])
    );

    // Recover signer
    const signer = await recoverAddress({ hash: digest, signature: proof.signature as `0x${string}` });

    if (signer.toLowerCase() !== proof.agentWallet.toLowerCase()) {
      return { valid: false, error: `Signature mismatch: signed by ${signer}, expected ${proof.agentWallet}` };
    }

    return { valid: true, signer };
  } catch (e: any) {
    return { valid: false, error: e.message ?? "Unknown verification error" };
  }
}

/**
 * Compute the deliverable hash from raw content.
 * Agents should call this helper or compute keccak256 client-side.
 */
export function hashDeliverable(content: string): string {
  return keccak256(Buffer.from(content, "utf8"));
}
