# 🔎 Abhimanyu

### Local Financial-Transaction Investigation & Evidence Analysis Platform

**Transaction Investigation** · **Financial Crime Analysis** · **Entity Intelligence** · **Anomaly Review** · **Evidence Workflows**

Abhimanyu is a locally run investigation platform designed to help investigators explore financial-transaction data, trace connected accounts, review risk and anomaly indicators, and prepare evidence-oriented case reports.

The final working application is branded **Abhimanyu** and lives inside `abhedya-chakra-starter/`. It combines a local analytical backend with an interactive investigation workspace covering transaction networks, timeline replay, account intelligence, anomaly review, case reports, CSV import, and visual trace exploration.

> **Important:** Abhimanyu is an investigative assistance tool. Risk indicators, transaction cues, correlations, narration, IP addresses, and other generated leads do **not** by themselves establish fraud, identity, intent, purpose, or geographic location.

---

## ✨ Key Features

### 🕸️ Interactive Transaction Network

Explore relationships between accounts and transactions through an interactive network view.

Investigators can follow connected transaction paths and examine relationships between accounts within the loaded dataset.

### ⏱️ Timeline Replay

Replay investigation stages and transaction activity through a continuous animated workspace.

Risk scores and lead rationale are presented alongside the investigation flow.

### 🌍 3D Global Trace

The application provides a 3D trace visualization for exploring transaction relationships.

> Globe coordinates are schematic plot positions and should **not** be interpreted as actual geographic locations.

### 👤 Account Intelligence

Search and investigate accounts using transaction relationships and available account-level analytical information.

### ⚠️ Anomaly & Risk Review

Abhimanyu provides transaction-cue screening and anomaly/risk indicators to help investigators identify records that may deserve additional review.

These indicators are intended as **screening aids**, not calibrated probabilities or definitive fraud classifications.

### 📂 CSV Import

Import transaction datasets directly through the application.

The import workflow:

```text
CSV File
   │
   ▼
Validation
   │
   ▼
Normalization
   │
   ▼
Transaction Dataset
   │
   ├── Account Intelligence
   ├── Transaction Analysis
   ├── Network Investigation
   └── Risk / Anomaly Review
```

The currently loaded transaction dataset is replaced after a confirmed import.

### 📄 Case Reports

Transactions & Reports provides tools for preparing investigation material, including:

- Transaction and IFSC-code search
- Investigation summaries
- Local report drafts
- Full-text report copying
- Prefilled email preparation for user review
- Links to India's official cybercrime reporting portal
- Local CSV upload audit information
- Rollback of the latest upload

Abhimanyu **does not submit an FIR or send reports on the investigator's behalf**.

### 🤖 Optional Local AI

An optional case-diary summary can use a **local Ollama model**.

If Ollama is unavailable, Abhimanyu falls back to a deterministic evidence summary.

No external AI service is required for the core investigation workflow.

---

## 🧭 Investigation Workspace

Abhimanyu is designed around a continuous investigation experience rather than a traditional vertical sidebar.

The workflow brings together:

```text
                 ┌─────────────────────┐
                 │ Transaction Dataset │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   Data Validation   │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Investigation    │
                 │       Workspace     │
                 └──────────┬──────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
       🕸️ Network       ⏱️ Timeline      🌍 Trace
            │               │                │
            └───────────────┼────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │ Account Intelligence│
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Risk / Anomaly      │
                 │ Review              │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Case Reports        │
                 └─────────────────────┘
```

The graph and globe views can also be expanded into fullscreen mode for investigation.

---

## 📥 Importing Transaction Data

Use **Import CSV** in the top navigation to load a transaction dataset.

The application asks for confirmation because importing a CSV replaces the currently loaded transaction dataset.

The CSV must contain the required transaction columns defined by:

```text
abhedya-chakra-starter/
└── backend/
    └── app/
        └── services/
            └── normalize.py
```

### Import Constraints

The application validates imported CSV files and limits them to:

| Constraint | Limit |
|---|---:|
| Rows | 2,000,000 |
| Columns | 64 |
| Characters per field | 1,000,000 |

Imports must use:

- UTF-8 CSV encoding
- Unique column names
- Well-formed rows

The API does not accept filesystem paths as import inputs.

> **Data safety:** Use only trusted transaction datasets. Transaction narration and IP addresses are displayed as supplied by the source records and do not independently prove actual purpose, identity, or location.

---

## 🔐 Local Security

Abhimanyu is designed to run locally.

The launcher binds the frontend and API to:

```text
127.0.0.1
```

Do **not** change the development servers to:

```text
0.0.0.0
```

or otherwise expose them to an untrusted network.

The API also restricts write requests to local browser origins and rejects untrusted host names.

### Operational Recommendations

These application-level safeguards do not replace operating-system security.

Keep the following updated:

- Windows
- Microsoft Defender
- Python dependencies
- Node.js dependencies

Avoid running the application or importing untrusted files with administrator privileges.

---

## 🏗️ Project Structure

```text
Abhimanyu1/
│
├── README.md
├── start-combined.ps1
├── .gitignore
│
├── abhedya-chakra-starter/
│   │
│   ├── backend/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── schemas/
│   │   │   └── services/
│   │   │
│   │   ├── tests/
│   │   └── requirements.txt
│   │
│   ├── frontend/
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   │
│   ├── data/
│   │   ├── raw/
│   │   ├── processed/
│   │   └── exports/
│   │
│   ├── scripts/
│   ├── templates/
│   └── benchmarks/
│
└── siyakafile/
    └── excluded from the public repository
```

### Legacy Naming

The active application remains under the `abhedya-chakra-starter/` directory.

The folder name and legacy environment-variable names are intentionally unchanged to preserve existing paths and local datasets.

---

## ▶️ Running Abhimanyu

### Windows PowerShell

From the repository root:

```powershell
.\start-combined.ps1
```

The launcher starts the local frontend and API services.

### Application

Open:

```text
http://127.0.0.1:5173
```

### API Documentation

Open:

```text
http://127.0.0.1:8000/docs
```

---

## 🧪 Testing

The backend contains tests covering areas such as:

- CSV upload
- Graph tracing
- Cycle detection
- Rapid pass-through detection
- Risk scoring
- Report generation
- Local AI functionality

Backend tests are located under:

```text
abhedya-chakra-starter/backend/tests/
```

---

## 🛠️ Technology Architecture

```text
                  ┌──────────────────┐
                  │   Transaction    │
                  │       CSV        │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │    FastAPI       │
                  │     Backend      │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  Validation &    │
                  │  Normalization   │
                  └────────┬─────────┘
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
        Account Data   Transactions   Evidence
             │             │              │
             └─────────────┼──────────────┘
                           ▼
                  ┌──────────────────┐
                  │ Investigation    │
                  │ Analysis Layer   │
                  └────────┬─────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      🕸️ Graph        ⚠️ Risk         ⏱️ Timeline
      Analysis        Review           Replay
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                  ┌──────────────────┐
                  │ Investigation    │
                  │     Reports      │
                  └──────────────────┘
```

---

## 📊 Investigation Outputs

The platform is designed to help investigators move from raw transaction records toward structured investigative material.

Typical workflow:

```text
Raw Transactions
       ↓
Validation
       ↓
Normalization
       ↓
Account / Transaction Analysis
       ↓
Relationship Exploration
       ↓
Risk & Anomaly Review
       ↓
Evidence Summary
       ↓
Case Report Draft
```

The generated outputs should always be reviewed by the investigator against the original source records.

---

## ⚖️ Responsible Use

Abhimanyu is designed as an **investigative assistance platform**, not an autonomous fraud-detection or law-enforcement decision system.

The application should not be used to conclude that an individual or account is fraudulent solely because:

- an account has a high risk score
- a transaction is flagged
- two entities are correlated
- an IP address appears in multiple records
- a narration contains suspicious wording
- a transaction follows a particular flow

Such indicators are intended to help identify areas for further investigation.

---

## 🔭 Future Improvements

Potential future improvements include:

- [ ] More advanced entity resolution
- [ ] Improved transaction anomaly detection
- [ ] Calibrated risk models
- [ ] More detailed evidence timelines
- [ ] Additional transaction formats
- [ ] Expanded account intelligence
- [ ] Interactive investigation graph improvements
- [ ] Additional report templates
- [ ] Extended forensic artifact support
- [ ] More comprehensive investigation audit trails

---

## 👨‍💻 Author

### Akshay Yellaram

**Cybersecurity & IoT Student**

Cybersecurity · Digital Forensics · AI/ML · Blockchain · Ethical Hacking

---

## ⚠️ Disclaimer

Abhimanyu is a local investigation and evidence-analysis prototype.

It does **not** independently establish fraud, criminal intent, identity, transaction purpose, or geographic location.

All analytical indicators and generated reports should be validated against the original evidence and appropriate investigative procedures before any operational, disciplinary, or legal action.
