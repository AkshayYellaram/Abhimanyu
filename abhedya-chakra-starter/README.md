# Abhimanyu

Abhimanyu is a local-first investigation platform for transaction ingestion, account search,
bounded downstream tracing, heuristic risk triage, and evidence-backed draft
reports. The frontend includes a guided, animated investigation slide flow,
a layered transaction graph, timeline replay, and an Abhimanyu-inspired 3D
global trace globe.

## Requirements
- Python 3.11 or 3.12 recommended
- Windows PowerShell, macOS, or Linux
- Internet is needed once to install Python dependencies; core API runs locally afterward.

## Start (Windows PowerShell)
```powershell
cd abhedya-chakra-starter
.\scripts\run_backend.ps1
```
In a second PowerShell window:
```powershell
cd abhedya-chakra-starter\frontend
npm install
npm run dev
```
API docs: http://127.0.0.1:8000/docs  
Health: http://127.0.0.1:8000/health

Or run both services from the parent workspace with `.\start-combined.ps1`.

## Global trace globe

Navigate through one continuous investigation flow: brief/timeline,
money-flow analysis, account intelligence, global trace globe,
transactions/reports, and anomaly detection appear sequentially in one
scrollable workspace. Use the sticky progress bar, previous/next controls, or
left/right arrow keys; the fixed vertical sidebar has been removed. Each step opens with its risk score and
reason for review; account intelligence shows the full indicator list.

The money-flow slide arranges the selected account, collector candidates,
distributor candidates, cash-out indicators, and other participants in
separate columns. Click an account to focus the trace or a connection to inspect
its source transaction. Search, zoom, and drag to pan around larger traces.
Use the fullscreen controls to expand either the graph or globe; the globe
renderer resizes with its panel. Layer roles are heuristics derived from the
visible trace, not verified facts.

On the **Global trace globe** slide, routes are built from the currently
loaded, time-filtered transaction trace. Select or click an account to see its
plot coordinates and associated recorded IPs in the globe panel. Selecting a
transfer shows its source-record IP, narration, payment mode, and device type
when available. Coordinates are stable schematic plot positions, not
geolocation; the dataset does not supply verified account coordinates.
Color-coded collector/distributor/terminal roles are candidates inferred from
the visible trace, not verified classifications. IP addresses and narration
do not prove location, identity, or actual transfer purpose.

## Transaction screening and public report drafts

The **Transactions & reports** stage includes a searchable suggestion list
matching transaction IDs, account IDs, narration, payment mode, timestamp, and
amount, and sender/receiver IFSC codes. A dedicated IFSC search bar finds
transactions by full or partial sender or receiver branch code. Each visible transfer and its detail view show a transaction-level
screening index derived only from configured cues in that record: cash-out or
high-risk narration keywords, selected device types, proxy-risk IP prefixes,
and later trace-hop position. This is an uncalibrated triage index, not a
probability, account-risk score, or determination of wrongdoing; a missing cue
does not establish that a transfer is safe. The case-report view summarizes
screening levels and the 20 highest-scoring visible transactions, while the
case JSON export includes screening scores and reasons for every visible trace
transaction.

The public report form creates a local text draft, copies the complete report
text, or opens a prefilled email in the user's configured mail application.
Long drafts use a shorter email body to avoid mail-client URL size limits; the
full text remains available to copy or download. The India National Cyber Crime Reporting Portal
link opens `https://cybercrime.gov.in/`. The app does not send email, file an
FIR, or submit the portal form. Review all entered details and follow the
official portal's instructions before submission. Avoid entering passwords,
PINs, or full payment-card details.

## Import a transaction CSV

Use **Import CSV** in the application header and choose a `.csv` file. Import
replaces the active transaction dataset, so the UI requests confirmation.
There is no application-level file-size limit; CSV imports are still limited
to 2,000,000 rows, 64 columns, and 1,000,000 characters per field. Required
headers are defined in `backend/app/services/normalize.py`. A successful
import refreshes the account investigation and anomaly results. The local CSV
upload audit trail records imports and rollbacks. The UI can roll back the
latest uploaded CSV and restore the prior transaction dataset; if there was no
prior dataset, rollback removes the imported dataset. Direct ingestion via
`/api/ingestion/csv` is not included in this upload-specific audit trail.

## Load the supplied CSV
Copy the CSV to `data/raw/`, then call the ingestion endpoint:
```powershell
$body = @{ path = (Resolve-Path ".\data\raw\VoidHacks8_MuleAccount_2M_Transactions.csv").Path } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/ingestion/csv" -ContentType "application/json" -Body $body
```
Or use Swagger UI at `/docs`, POST `/api/ingestion/csv`, with body:
```json
{"path":"D:\\full\\path\\to\\VoidHacks8_MuleAccount_2M_Transactions.csv"}
```
Only load trusted local CSV files. The API accepts a server-local path; do not expose this endpoint to untrusted users or the public internet.

## Useful endpoints
- `GET /health`
- `POST /api/ingestion/csv`
- `POST /api/ingestion/upload`
- `GET /api/ingestion/history`
- `POST /api/ingestion/rollback`
- `GET /api/accounts/search?q=123`
- `GET /api/accounts/{account_id}`
- `GET /api/investigations/trace/{account_id}?max_hops=4`
- `GET /api/investigations/outgoing/{account_id}?hop=0&max_hops=4&limit=100&offset=0`
- `GET /api/investigations/risk/{account_id}`
- `POST /api/reports/case-diary` with `{"victim_account":"...","max_hops":4}`

The Case Reports view summarizes direct observed outflow, returned transfers,
downstream accounts, and gross traced value, with a hop-by-hop value chart and a
transaction-screening table. **Download Professional Case Diary (HTML)** exports
a print-ready report with chronological case-diary entries, layer-wise accounts
and transaction amounts/timestamps, potential trace-leaf accounts for urgent
bank-balance verification, and one records-production draft per receiving IFSC.
The template identifies Section 94 BNSS / Section 91 CrPC as an applicable
records-production reference to be verified by the issuing authority; it does
not present either as standalone authority to freeze an account. Current
balances and confirmed victim loss are not available from transaction traces;
they are explicit officer/bank verification fields. Raw IP/device metadata is
kept separately in the JSON export. Gross traced value may count the same value
at multiple hops and is not confirmed loss.

## Reproducible evaluation
Run the trace and account-summary benchmark against the configured DuckDB (the five named smoke-test accounts plus five reproducibly sampled accounts by default), and optionally benchmark a full CSV import in a temporary database (the production database is not replaced):
```powershell
.\backend\.venv\Scripts\python.exe .\scripts\benchmark_engine.py
.\backend\.venv\Scripts\python.exe .\scripts\benchmark_engine.py --csv .\data\raw\VoidHacks8_MuleAccount_2M_Transactions.csv
```
The ingestion measurement includes normalization, three indexes, core/account/IFSC/payment/IP validation, and unique-account counting. It also reports process peak working set and machine RAM. Trace results report latency and whether the bounded trace was truncated; an under-two-second truncated result is not a complete-trace pass. Results are hardware-specific; use the evaluation laptop for the 60-second / 16-GB target.

The API and analytics connections default to four DuckDB threads, a 12 GB
memory cap, and a local spill directory under `data/processed/duckdb_tmp`.
Override these with `ABHEDYA_DUCKDB_THREADS`,
`ABHEDYA_DUCKDB_MEMORY_LIMIT`, and `ABHEDYA_DUCKDB_TEMP_DIR` when starting the
backend. The frontend graph displays up to 1,500 accounts at a time. When the
initial trace is truncated, select an account in the graph to fetch its outgoing
transfers in pages of 100. Downstream expansion requires a recorded receipt
timestamp and respects it; the overall trace remains marked incomplete because
not every branch is expanded automatically.

The case diary can use Ollama on `127.0.0.1:11434` with `qwen3:4b` for an
additional summary based only on aggregate counts and amounts. Narration and
account identifiers are not sent to the model. Install Ollama, run
`ollama pull qwen3:4b`, then start its local service before generating a
report. Keep cloud features disabled by starting the service with
`$env:OLLAMA_NO_CLOUD = "1"; ollama serve`. Override the model with
`ABHEDYA_LOCAL_LLM_MODEL`. If Ollama or the
model is unavailable, the app retains the deterministic summary and marks
the local AI status as unavailable; generated text always requires review.
The first report may wait up to three minutes for a cold model start; after a
successful request, Ollama keeps the model loaded for ten minutes.

Evaluate detector predictions only when an independently labeled account file is available. Supply a CSV with `account_id,label`, where labels can be `mule`/`regular` or boolean values:
```powershell
.\backend\.venv\Scripts\python.exe .\scripts\evaluate_detector.py --labels .\path\to\ground_truth.csv
```
By default this compares the labels to `data/processed/account_anomaly_scores.csv` using `anomaly_flag`. To evaluate numeric risk scores instead, provide `--prediction-column risk_score --threshold 70`. Do not treat the bundled unsupervised anomaly flags as ground truth.

## Current prototype limitations
- Trace returns a bounded set of outgoing transactions, excludes transfers before receipt in the query, and does not continue a path through transfers with missing timestamps. This is not exact fund attribution; broad four-hop networks can exceed the response cap and are explicitly marked truncated.
- The timeline slider filters the returned trace in one-minute increments; it does not independently scan every transaction in the dataset.
- Risk rules are baseline heuristics, not validated classifiers. The rapid pass-through ratio requires one incoming transaction to be split across at least two distinct outflows, FIFO-matched once within the 3-15-minute window; it remains a timing heuristic and does not prove fund provenance. Directed-cycle detection is bounded to four hops and 10,000 scanned edges; incomplete scans are reported as such. Aggregate outflow/inflow is not time-matched.
- IP/device/narration indicators are weak signals and must not be treated as proof. The `185.x` / `194.x` prefix checks are proxy-risk candidates only; the system has no offline geolocation or reliable domestic/foreign attribution.
- The case diary and freeze requisition are drafts for authorized review, not issued notices or official legal forms. The API returns JSON and the frontend can open a printable review rendering. The report sum can count the same money at multiple hops; it is not a unique stolen-funds total.
- The case diary includes a deterministic, database-grounded narrative. When local Ollama is running, it can additionally generate a constrained summary from aggregates only; account identifiers and imported narration are not sent to it. The generated summary is separately labeled unverified and requires human review.
- Graph isolation operates on the currently loaded, time-filtered trace component; its CSV export does not claim to include transactions outside that trace.
- Legal notice wording and authority require review by authorized law enforcement/legal personnel. The bundled data does not provide verified account balances or confirmed victim-loss amounts.
- The frontend uses system fonts and local assets so it does not fetch Google Fonts or require cloud services at runtime.
- Confirm applicable legal provisions and notice wording with authorized personnel.
- On the current 2-million-row dataset, the full upload endpoint completed in 22.0 seconds and the standalone DuckDB benchmark in 9.8 seconds on a 16-GiB machine. These are machine-specific results, not a guarantee for other hardware.
- The current 10-account, 50,000-record trace benchmark returned 9 truncated traces. It therefore does not satisfy a complete four-hop trace requirement for those accounts, despite remaining below two seconds per trace.
- The current anomaly file contains 24,873 unlabeled accounts and 498 flagged accounts. Without independent labels, precision/recall against the required 1,500 mule and 23,500 regular accounts cannot be established; do not interpret anomaly flags as ground truth.
- A real browser run rendered 1,500 accounts and 1,675 route groups from the 2-million-row dataset. The UI now states how many route groups are omitted from the current view; this smoke test does not replace evaluation on the judges' hardware and victim accounts.
