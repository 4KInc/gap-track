# AWS integration

For the AWS Builder mini challenge. Every service here is load-bearing: remove
any one and the safety guarantee loses the number it depends on.

> Status: **not yet implemented.** This document is scaffolding, filled in as the
> engine is built. Nothing below is claimed as working until it is.

## Services

| Service | Job | Why it cannot be removed |
|---|---|---|
| Amazon Bedrock | Generates the candidate description under a word budget derived from the measured gap | The budget is an input to generation, not a filter applied afterwards |
| Amazon Polly | Synthesises the narration; the generated asset is then measured | Admission control compares a **measured** duration, never a model's estimate of speaking time |
| Amazon S3 | Caches approved cue audio keyed by media hash and timestamp | Without it, every replay regenerates — cost and latency both unbounded |

Deliberately excluded: Lambda, DynamoDB and CloudWatch. They would raise the
service count without doing work the pipeline needs, which is the decorative
integration the judging rubric screens for. If asynchronous cache-miss handling
later needs orchestration, Lambda earns its place then.

## The integrity rule

The final play-or-drop decision uses the duration of the **synthesised audio
asset**, measured after synthesis. Not a token estimate, not a words-per-minute
calculation, not a model's self-report.

## To document as built

- [ ] IAM policies and least-privilege roles
- [ ] Region and model IDs
- [ ] Prompt and structured output schema
- [ ] Cache key derivation
- [ ] Cost per described hour, measured
- [ ] Failure behaviour per service
