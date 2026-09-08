# Quiz AI Settings

## Administrator flow

Open **Admin > Operations > AI settings** (`/admin/operations/ai`). Choose a preset or enter a model ID, then save. The page distinguishes the saved model from the draft and preserves input after a failed save. Loading failures offer a retry. Choosing the default changes the draft; it still requires saving.

The shared model applies to the next quiz API request across workers. Requests already in flight finish with their original model. Saving does not invoke OpenAI, restart jobs, or replay failed quizzes. API keys remain in the existing GitHub Actions secret; they are not stored or returned by this page.

## Selection and request compatibility

The cost-sensitive default is `gpt-5.6-luna`. The presets below use official standard token prices checked on **2026-09-08**, in USD per million tokens. Prices are reference values, not a bill estimate.

| Preset | Input | Output | Intended choice |
| --- | ---: | ---: | --- |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | $0.20 | $1.20 | Low-cost default for high-volume questions |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | $2.00 | $12.00 | More capable balanced option |
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | $4.00 | $20.00 | Higher-capability option |

Actual cost depends on input, output, reasoning tokens, and the provider's current pricing. Course-specific correctness has not been established by these price comparisons.

The worker retains Chat Completions and the existing quiz JSON contract. Presets request low reasoning effort and at most 4,096 completion tokens, including reasoning. Temperature is omitted. Custom IDs must support Chat Completions, JSON object output, and the completion-token parameter; custom IDs do not inherit reasoning options. Saving validates ID syntax only, not model existence or access.

## Storage and rollout

`AppSettings.quizModel` defaults to Luna. The worker reads it for every question. A missing singleton row uses that default; storage failures stop generation. `OPENAI_MODEL` is retired and no longer overrides the saved value.

1. Run required validation and review the additive schema change.
2. Apply `DB Bootstrap` on the reviewed branch before merging, so scheduled workers on the new main can read the column immediately.
3. Merge after required checks pass. Once the new workflow is available on main, run **Quiz Model Check**. It calls the saved model with three synthetic questions and the existing API key. It does not access a real course or submit answers. Logs contain only an aggregate result and sanitized error status/code. The three requests incur ordinary token charges.
4. Verify the production deployment and health check. The deployment's schema sync is idempotent.
5. Confirm the selected model under AI settings. Changing it affects future requests without redeploying.

An API 400/401/403/404 or invalid stored model ID ends the current AUTOLEARN job without retrying the same configuration. Recognized quota/billing 429 errors also remain terminal; ordinary transient 429/5xx errors retain retry handling. A response cut off at the token limit is rejected before submission. Failed jobs require a new request after correcting the cause.

The synthetic check verifies basic access and choice/text/sequence response compatibility. Monitor real quiz outcomes separately before concluding that a model meets the required accuracy.

## Local validation record

The real settings component was rendered with synthetic admin/API fixtures at 1440, 1024, 719, and 390 pixels. Save/reload, failed-save draft preservation, initial-load failure, disabled editing before load, and retry recovery were checked in a browser. No document overflow was observed. API tests cover admin/CSRF enforcement, field isolation, invalid IDs, and storage failures; worker tests cover saved-model refresh, custom-model parameters, missing-row defaults, and incomplete-response rejection.
