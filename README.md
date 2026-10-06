# Abhimanyu investigation platform

The final working app is branded **Abhimanyu** and lives in
`abhedya-chakra-starter/`. It combines the local analytical backend and
evidence workflow with an interactive transaction network, timeline replay,
3D global trace, account intelligence, anomaly review, case reports, and CSV
import. Investigation stages run in one animated slide flow, with the current
risk score and lead rationale appearing at each step as the investigator scrolls
through the graph, globe, and evidence views in a single continuous workspace.

## Start

From this folder in Windows PowerShell:

```powershell
.\start-combined.ps1
```

Open the app at http://127.0.0.1:5173 and the API docs at
http://127.0.0.1:8000/docs.

## Import a transaction CSV

Use **Import CSV** in the top bar and select a `.csv` file. Import replaces
the currently loaded transaction dataset, so the app asks for confirmation
first. The CSV must contain the required transaction columns described in
`abhedya-chakra-starter/backend/app/services/normalize.py`. There is no
application-level file-size limit; CSV imports are still limited to 2,000,000
rows, 64 columns, and 1,000,000 characters per field. On success, Abhimanyu
refreshes its investigation and account data.

Use only trusted data. Transaction narration and IPs are displayed as supplied
by records and do not prove actual purpose, identity, or location. Globe
coordinates are schematic plot positions, not geographic locations.

## Local security

The launcher binds the frontend and API to `127.0.0.1`; do not change this to
`0.0.0.0` or expose these development servers to a network. The API only accepts
local browser origins for write requests and rejects untrusted host names.
CSV imports have no application-level file-size limit, but are limited to
2,000,000 rows, 64 columns, and 1,000,000 characters per field. Imports must be
UTF-8 CSVs with unique columns and well-formed rows. The API does not accept
filesystem paths for imports.

These application safeguards do not replace operating-system protection.
Keep Windows, Microsoft Defender, and dependencies up to date, and do not run
the app or import files from untrusted sources with administrator privileges.

The vertical sidebar is removed in favor of the continuous slide navigation.
The graph and globe can be expanded to fullscreen. Transactions & reports
includes transaction and IFSC-code search, an uncalibrated transaction-cue
screening index, and a local CSV upload audit trail with rollback of the latest
upload. Public report tools create a local draft, copy its full text, open a
prefilled email for user review, or link to India's official cybercrime portal.
Abhimanyu does not submit an FIR or send reports on the user's behalf.
An optional case-diary summary uses a local Ollama model; if Ollama is
unavailable, the deterministic evidence summary remains available.

## Project folders

- `abhedya-chakra-starter/` — active Abhimanyu app, backend, frontend, data,
  tests, and benchmark/evaluation scripts. The folder name and legacy
  environment variable names remain unchanged to preserve existing paths and
  local datasets.
- `siyakafile/Abhimanyu/Abhimanyu/` — original reference implementation.
