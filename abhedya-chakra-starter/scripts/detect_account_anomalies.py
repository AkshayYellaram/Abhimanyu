from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

INPUT = Path("data/processed/account_features.parquet")
OUTPUT = Path("data/processed/account_anomaly_scores.csv")

if not INPUT.exists():
    raise FileNotFoundError(f"Feature dataset not found: {INPUT}")

if OUTPUT.exists():
    raise FileExistsError(
        f"{OUTPUT} already exists. Rename it before running again."
    )

db = duckdb.connect()
try:
    df = db.execute(
        "SELECT * FROM read_parquet(?)", [str(INPUT)]
    ).fetchdf()
finally:
    db.close()

account_ids = df["account_id"].copy()

excluded = {"account_id", "first_seen", "last_seen"}
feature_cols = [
    col for col in df.columns
    if col not in excluded
    and pd.api.types.is_numeric_dtype(df[col])
]

X = df[feature_cols].replace([np.inf, -np.inf], np.nan)

feature_cols = [
    col for col in X.columns if X[col].notna().any()
]
X = X[feature_cols]

if len(df) < 10:
    raise ValueError("Not enough accounts for anomaly detection.")

model = make_pipeline(
    SimpleImputer(strategy="median"),
    StandardScaler(),
    IsolationForest(
        n_estimators=200,
        contamination=0.02,
        random_state=42,
        n_jobs=-1
    )
)

print("Training anomaly detector...")
model.fit(X)

predictions = model.predict(X)
decision_scores = model.decision_function(X)

results = pd.DataFrame({
    "account_id": account_ids,
    "anomaly_flag": predictions == -1,
    "anomaly_score": -decision_scores
})

results["model_type"] = "IsolationForest_unsupervised"
results["interpretation"] = (
    "Unusual behaviour; requires human investigation"
)

results = results.sort_values(
    "anomaly_score", ascending=False
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
results.to_csv(OUTPUT, index=False)

print("\nANOMALY DETECTION COMPLETED")
print("Accounts analysed:", len(results))
print("Features used:", len(feature_cols))
print("Feature names:", ", ".join(feature_cols))
print("Flagged accounts:", int(results["anomaly_flag"].sum()))
print("Output:", OUTPUT.resolve())

print("\nTop 10 unusual accounts:")
print(results.head(10).to_string(index=False))
