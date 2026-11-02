# Guided workflows

Liminal provides three guided workflows in desktop, web, and terminal chat. Each combines a fixed recipe with tools, saved evidence, and a deliverable check. They are included in desktop and harness 0.1.5.

## Enquiry to proposal

Use the **Enquiry to proposal** welcome card, or enter:

```text
/proposal Example Retail needs an accessible contact form on its existing site.
Scope: one page, no CRM or payments. Indicative budget: AUD 1200, subject to review.
Research relevant accessibility guidance. Do not promise a delivery date.
```

Supply the enquiry, client identity, known scope, constraints, and any agreed commercial facts. Missing facts should become questions or explicit assumptions. The workflow researches relevant pages and saves:

- `proposal.html`: styled, printable proposal; open in a browser and print if needed.
- `proposal.md`: editable proposal with sources.
- `reply-draft.eml`: unsent plain-text email draft with `X-Unsent: 1`.
- `research.json`: sources that were successfully fetched.

Review the scope, price, commitments, and research before sending. The workflow does not send the reply. It cannot finish with fabricated or unfetched source URLs.

## Receipt to expense review

Attach a clear PNG, JPEG, WebP, BMP, or TIFF image, then type:

```text
/receipt Prepare a local expense review. Ask me about any unclear amounts.
```

Use one expense per run; several images may represent pages of the same receipt. Local English OCR runs first, without a secondary hosted language model. Its language data downloads once into `.agent_artifacts/ocr-cache/`; the image stays local during OCR. The configured chat model receives the extracted text. As with ordinary image attachments, a vision-capable selected model may also receive the attached image through its configured provider.

OCR can make mistakes. Low confidence, unreadable dates, ambiguous tax, or missing currency must be resolved before proceeding. PDF pages must be converted to images. Images are limited to 10 MiB each. Review fields use tax-exclusive unit prices and total line tax; line totals and tax must reconcile to the reviewed total within one cent.

The default result is `expense-review.json` and `expense-review.md`, with the merchant, date, currency, lines, total, tax, and SHA-256 hashes of the original images. No accounting write is needed for a local review.

For a Xero draft, connect the intended organisation first and explicitly request it:

```text
/receipt Prepare this expense for Xero. Check for duplicates, map the supplier,
account and tax codes, and ask for approval before creating a draft bill.
```

The workflow requires the review first, a conclusive duplicate check for the supplier and amount, account/tax codes observed in successful lookups for that organisation, and approval for `xero_create_bill` under normal approval settings. It sends a tax-exclusive ACCPAY bill with `Status=DRAFT`, matching date/currency/quantities/prices, then uploads the original image to the returned InvoiceID. It checks the returned total/currency and attachment before saving `xero-handoff.json`.

A failed attachment is a partial result. Resume the run and retry against the existing bill ID; do not create another bill. A changed source image invalidates recovery. A mismatching returned total requires inspection of the existing draft. The workflow does not authorise, pay, or email bills. Approval settings such as YOLO retain their usual effect; workflow checks are application safeguards, not a sandbox for arbitrary code or HTTP tools.

## Bug report to verified patch

Bind the chat to the project folder. The current verifier supports Git repositories with npm test scripts:

```text
/fix sum(2,3) returns -1; expected 5. Reproduce with the focused regression test,
fix the implementation, then save the tested diff and handoff.
```

The workflow must reproduce a failure with `run_tests`, edit the implementation, run a real passing test after the last edit, and inspect a fresh `git_diff`. A missing script, zero-test report, failed test, or verification overlapping an edit cannot satisfy completion. For a custom npm script, use `run_tests` with its `script` argument.

The result is `patch.diff`, `test-evidence.txt`, and `handoff.md`. The handoff records changes, verification, and limitations. No commit, push, or deployment is part of this workflow. Focused tests establish only the behaviour they exercise. Projects without a suitable test setup should record the missing prerequisite rather than claim a verified patch.

## Resume or stop a run

The completed tool card provides file buttons: desktop opens a local file; web downloads it from the active workspace.

Artifacts and `run.json` live under:

```text
<chat workspace>/.agent_artifacts/workflows/<run-id>/
```

Use `/workflows` in the same workspace to list saved runs, then `/resume-work <run-id>`. Receipt recovery restores the reviewed values and successful draft/attachment results. Patch recovery requires fresh tests and a fresh diff because the repository may have changed while Liminal was closed.

Ask to cancel the active workflow to invoke `work_package action=cancel`. Starting another preset starts a new run; the previous run remains on disk. A new/reset chat clears the active workflow. A blocked run records its missing prerequisite and can be resumed after it is resolved.

## Verify the implementation

After installing dependencies and building:

```bash
npm run build
npm run verify:workflows
npm run verify:workflows:live
```

`verify:workflows` runs deterministic checks, including the actual Xero tool adapters with a fixture transport: draft payload/currency, receipt bytes, failed-upload recovery, and prevention of a second bill in that saved run. It does not write to a real Xero organisation.

`verify:workflows:live` uses your configured model/API key and synthetic projects under `.agent_artifacts/`. Normal provider charges apply. It fetches W3C guidance, reads the included demo receipt with real local OCR, and repairs a failing test in an isolated Git fixture. It asserts the saved deliverables and values. It does not send email, write to Xero, or modify your project. `node scripts/verify-signature-workflows.mjs --full-tools` additionally exercises the production prompt and full lazy tool catalog while bounding fixture side effects. Pass `proposal`, `receipt`, or `patch` to select a case.

Live verification has exercised the selected GLM model in single-model mode; it is not a benchmark or a guarantee that every provider/model can follow these recipes. The Xero write path is adapter-tested with fixtures, not live-account certified.
