"""Evaluate account predictions against an independently labeled CSV."""

import argparse
import csv
import json
from pathlib import Path


TRUE_VALUES = {"1", "true", "yes", "mule", "positive"}
FALSE_VALUES = {"0", "false", "no", "regular", "negative"}


def read_column(path: Path, key_column: str, value_column: str, threshold=None):
    values = {}
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or key_column not in reader.fieldnames:
            raise ValueError(f"{path} must contain column {key_column!r}.")
        if value_column not in reader.fieldnames:
            raise ValueError(f"{path} must contain column {value_column!r}.")

        for row in reader:
            key = (row.get(key_column) or "").strip()
            raw_value = (row.get(value_column) or "").strip().casefold()
            if not key:
                raise ValueError(f"{path} contains a blank {key_column}.")
            if key in values:
                raise ValueError(f"{path} contains duplicate account {key!r}.")
            try:
                value = (
                    float(raw_value) >= threshold
                    if threshold is not None
                    else raw_value in TRUE_VALUES
                )
            except ValueError as exc:
                raise ValueError(
                    f"Value {raw_value!r} in {path} is not numeric."
                ) from exc
            if threshold is None and raw_value not in TRUE_VALUES | FALSE_VALUES:
                raise ValueError(
                    f"Value {raw_value!r} in {path} is not a supported label."
                )
            values[key] = value
    return values


def evaluate(labels: dict[str, bool], predictions: dict[str, bool]):
    matched = labels.keys() & predictions.keys()
    missing_predictions = labels.keys() - predictions.keys()
    extra_predictions = predictions.keys() - labels.keys()

    true_positive = sum(labels[key] and predictions[key] for key in matched)
    false_positive = sum(not labels[key] and predictions[key] for key in matched)
    false_negative = sum(labels[key] and not predictions[key] for key in matched)
    true_negative = sum(not labels[key] and not predictions[key] for key in matched)
    false_negative += sum(labels[key] for key in missing_predictions)
    true_negative += sum(not labels[key] for key in missing_predictions)

    precision = (
        true_positive / (true_positive + false_positive)
        if true_positive + false_positive
        else 0.0
    )
    recall = (
        true_positive / (true_positive + false_negative)
        if true_positive + false_negative
        else 0.0
    )
    specificity = (
        true_negative / (true_negative + false_positive)
        if true_negative + false_positive
        else 0.0
    )
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall
        else 0.0
    )
    return {
        "labeled_accounts": len(labels),
        "matched_accounts": len(matched),
        "missing_prediction_accounts": len(missing_predictions),
        "predictions_without_labels": len(extra_predictions),
        "ground_truth_mules": sum(labels.values()),
        "ground_truth_regular": len(labels) - sum(labels.values()),
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "true_negative": true_negative,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "specificity": round(specificity, 6),
        "f1": round(f1, 6),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument(
        "--predictions",
        type=Path,
        default=Path("data/processed/account_anomaly_scores.csv"),
    )
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--prediction-column", default="anomaly_flag")
    parser.add_argument("--account-column", default="account_id")
    parser.add_argument(
        "--threshold",
        type=float,
        help="Treat numeric prediction scores >= threshold as mule predictions.",
    )
    parser.add_argument("--expected-mules", type=int, default=1500)
    parser.add_argument("--expected-regular", type=int, default=23500)
    args = parser.parse_args()

    labels = read_column(
        args.labels,
        args.account_column,
        args.label_column,
    )
    predictions = read_column(
        args.predictions,
        args.account_column,
        args.prediction_column,
        threshold=args.threshold,
    )
    report = evaluate(labels, predictions)
    report["expected_ground_truth_counts"] = {
        "mules": args.expected_mules,
        "regular": args.expected_regular,
    }
    report["matches_expected_ground_truth_counts"] = (
        report["ground_truth_mules"] == args.expected_mules
        and report["ground_truth_regular"] == args.expected_regular
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
