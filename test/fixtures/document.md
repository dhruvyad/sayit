# Weekly numbers

Revenue is **up 12%**, churn is _flat_, and one thing needs a decision.

## Regions

| Region | Revenue | Change |
| --- | --- | --- |
| EMEA | $412k | +18% |
| AMER | $980k | +9% |

![the trend](chart.png)

- Renewals closed early
- Two accounts moved to annual
- One escalation is still ~~open~~ resolved

1. Confirm the EMEA forecast
2. Sign off on pricing

> The forecast assumes no further discounting.

See the [full model](https://example.com/model) or `SELECT * FROM revenue`.

```sql
select region, sum(amount) from revenue group by 1
```

Untrusted text: <script>alert(1)</script> and [a trap](javascript:alert(1)).

---

That is everything.
