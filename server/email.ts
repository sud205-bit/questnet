// server/email.ts
// Uses Resend API directly via fetch (no SDK needed)

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'QuestNet <notifications@questnet.ai>';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set, skipping email:', payload.subject, '->', payload.to);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: payload.to, subject: payload.subject, html: payload.html }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[email] Send failed:', err);
    } else {
      console.log('[email] Sent:', payload.subject, '->', payload.to);
    }
  } catch (e) {
    console.warn('[email] Error:', e);
  }
}

// Email template helpers
function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,sans-serif;background:#0a0a0f;color:#e0e0e0;margin:0;padding:0}
    .wrap{max-width:520px;margin:40px auto;padding:32px;background:#111118;border:1px solid #1e1e2e;border-radius:12px}
    h1{color:#00f5d4;font-size:22px;margin:0 0 16px}
    p{color:#a0a0b0;line-height:1.6;margin:8px 0}
    .stat{font-family:monospace;color:#00f5d4;font-size:18px;font-weight:700}
    .btn{display:inline-block;margin-top:24px;padding:12px 24px;background:#00f5d4;color:#0a0a0f;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px}
    .footer{margin-top:32px;padding-top:16px;border-top:1px solid #1e1e2e;color:#555;font-size:12px}
  </style></head><body><div class="wrap">
    <h1>${title}</h1>${body}
    <div class="footer">QuestNet · AI Agent Work Marketplace · <a href="https://questnet.ai" style="color:#00f5d4">questnet.ai</a></div>
  </div></body></html>`;
}

export async function sendBidReceivedEmail(to: string, questTitle: string, questId: number, agentHandle: string, bidAmount: number): Promise<void> {
  const body = `
    <p>Your quest <strong style="color:#fff">${questTitle}</strong> received a new bid from agent <strong style="color:#fff">${agentHandle}</strong>.</p>
    <p>Bid amount: <span class="stat">$${(bidAmount/100).toFixed(2)} USDC</span></p>
    <p>Review the bid and accept or reject it on QuestNet.</p>
    <a href="https://questnet.ai/#/quests/${questId}" class="btn">View Quest →</a>
  `;
  await sendEmail({ to, subject: `New bid on "${questTitle}"`, html: baseTemplate('New Bid Received', body) });
}

export async function sendBidAcceptedEmail(to: string, questTitle: string, questId: number, bounty: number): Promise<void> {
  const payout = Math.round(bounty * 0.975);
  const body = `
    <p>Your bid on <strong style="color:#fff">${questTitle}</strong> was accepted!</p>
    <p>Your payout on completion: <span class="stat">$${(payout/100).toFixed(2)} USDC</span></p>
    <p>Complete the quest and submit payment proof to claim your reward.</p>
    <a href="https://questnet.ai/#/quests/${questId}" class="btn">View Quest →</a>
  `;
  await sendEmail({ to, subject: `Your bid was accepted — "${questTitle}"`, html: baseTemplate('Bid Accepted 🎯', body) });
}

export async function sendQuestCompletedEmail(to: string, questTitle: string, questId: number, agentHandle: string, payout: number, txHash?: string): Promise<void> {
  const body = `
    <p>Quest <strong style="color:#fff">${questTitle}</strong> was completed by <strong style="color:#fff">${agentHandle}</strong>.</p>
    <p>Payout released: <span class="stat">$${(payout/100).toFixed(2)} USDC</span></p>
    ${txHash ? `<p style="font-size:12px;color:#555">Tx: <a href="https://basescan.org/tx/${txHash}" style="color:#00f5d4">${txHash.slice(0,18)}...</a></p>` : ''}
    <a href="https://questnet.ai/#/quests/${questId}" class="btn">View Quest →</a>
  `;
  await sendEmail({ to, subject: `Quest completed — "${questTitle}"`, html: baseTemplate('Quest Completed ✅', body) });
}

export async function sendEscrowReleasedEmail(to: string, questTitle: string, questId: number, amountUsdc: number, txHash: string): Promise<void> {
  const body = `
    <p>Escrow for <strong style="color:#fff">${questTitle}</strong> has been released.</p>
    <p>Amount: <span class="stat">$${(amountUsdc/100).toFixed(2)} USDC</span></p>
    <p><a href="https://basescan.org/tx/${txHash}" style="color:#00f5d4">View on Basescan →</a></p>
    <a href="https://questnet.ai/#/quests/${questId}" class="btn">View Quest →</a>
  `;
  await sendEmail({ to, subject: `Escrow released — "${questTitle}"`, html: baseTemplate('Payment Released 💸', body) });
}
