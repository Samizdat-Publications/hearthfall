# VisionQA calibration: probe results

Measured by `npm run visionqa:probe` on 2026-10-08 against `gpt-6-luna` on `POST /v1/decisions`. USD computed from `usage.input_tokens` at $0.10 per 1M input tokens. Probe spend: $0.001716. Verdict: **provider on (decisions)**.

| Image | Detail | Input tokens | USD per call | Latency ms |
|---|---|---|---|---|
| 1280x720 | low | 315 | 0.0000315 | 2279 |
| 1280x720 | auto | 1091 | 0.0001091 | 461 |
| 1280x720 | high | 1091 | 0.0001091 | 384 |
| 1280x720 | original | 1091 | 0.0001091 | 438 |
| 512x512 | low | 427 | 0.0000427 | 343 |
| 512x512 | auto | 427 | 0.0000427 | 289 |
| 512x512 | high | 427 | 0.0000427 | 322 |
| 512x512 | original | 427 | 0.0000427 | 294 |

Latency at low detail: sequential p50 423 ms, p95 930 ms (n=20); parallel p50 2842 ms, p95 3247 ms (n=10).

Six predicates on one image (low): 1088 input tokens, 523 ms, answers [1,0,1,1,0,0].
Eight images in one request (low): 1330 input tokens, 2082 ms.

Projected cost: smoke set (6 shots, low) $0.00019; full set (24 shots, low) $0.00076; full set at high $0.00262.

