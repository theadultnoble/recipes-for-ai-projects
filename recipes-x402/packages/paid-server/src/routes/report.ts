import { Router } from "express";

const router = Router();

router.get("/market-summary", (req, res) => {
  // Return mocked market report summary.
  res.json({
    status: "success",
    report: {
      summary:
        "The Base ecosystem is currently showing bullish sentiment... Ethereum seems to be on a down trend with all the quantum computing news circulating",
      eth_price: 64500,
    },
  });
});

export default router;
