import { Router } from "express";

const router = Router();

/**
 * Auth-only route: GET /report/wallet-profile
 *
 * Requires only wallet signature via SIWX — no payment.
 * Returns mock wallet profile data for the authenticated wallet.
 */
router.get("/wallet-profile", (req, res) => {
  res.json({
    status: "success",
    profile: {
      portfolio_value_usd: 12_480.55,
      active_chains: ["Base", "Ethereum", "Optimism"],
      top_holdings: [
        { token: "ETH", balance: 3.2, value_usd: 10_688.0 },
        { token: "USDC", balance: 1_792.55, value_usd: 1_792.55 },
      ],
      last_active: "2026-04-06T14:22:00Z",
      risk_score: "moderate",
    },
  });
});

export default router;
