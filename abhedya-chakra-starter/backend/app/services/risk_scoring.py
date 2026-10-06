def score_account(features: dict) -> dict:
    """Deterministic, explainable heuristic score. Validate weights against labels."""
    score = 0
    reasons = []

    rapid_ratio = float(features.get("rapid_pass_through_ratio", 0) or 0)
    distinct_senders = int(features.get("distinct_senders", 0) or 0)
    distinct_receivers = int(features.get("distinct_receivers", 0) or 0)
    terminal_indicators = int(features.get("terminal_indicators", 0) or 0)
    cycle_detected = bool(features.get("cycle_detected", False))

    # Rapid pass-through activity
    if rapid_ratio >= 0.90:
        score += 30
        reasons.append(
            "At least 90% of incoming value is FIFO amount-matched to outflows 3-15 minutes later."
        )

    # High fan-in: multiple sending accounts
    if distinct_senders >= 5:
        score += 25
        reasons.append(
            f"High fan-in: {distinct_senders} distinct sending accounts."
        )

    # Fan-out is a general risk signal; the L2 label uses the specified range.
    if distinct_receivers >= 3:
        score += 20
        reasons.append(
            f"Distributor-like fan-out: {distinct_receivers} distinct receiving accounts."
        )

    # Terminal or cash-out indicators
    if terminal_indicators > 0:
        score += 15
        reasons.append(
            f"{terminal_indicators} transaction(s) have terminal-risk indicators."
        )

    # Reciprocal transfers
    if cycle_detected:
        score += 10
        reasons.append(
            "A directed transfer cycle of at most four hops was detected."
        )

    if not reasons:
        reasons.append("No configured risk indicators were triggered.")

    # Preliminary topology-based classification
    if distinct_senders >= 5 and distinct_senders > distinct_receivers:
        layer = "L1"
        layer_name = "Collector-like"
    elif 3 <= distinct_receivers <= 7:
        layer = "L2"
        layer_name = "Distributor-like"
    elif terminal_indicators > 0:
        layer = "L3"
        layer_name = "Potential terminal / cash-out"
    else:
        layer = "Unclassified"
        layer_name = "Insufficient indicators"

    return {
        "risk_score": min(100, score),
        "risk_level": (
            "high" if score >= 70
            else "medium" if score >= 40
            else "low"
        ),
        "suspected_layer": layer,
        "layer_name": layer_name,
        "reasons": reasons,
        "features": {
            "rapid_pass_through_ratio": round(rapid_ratio, 4),
            "distinct_senders": distinct_senders,
            "distinct_receivers": distinct_receivers,
            "terminal_indicators": terminal_indicators,
            "cycle_detected": cycle_detected,
        },
        "disclaimer": (
            "Heuristic investigative lead only. A risk score or layer label "
            "does not establish criminal activity."
        ),
    }