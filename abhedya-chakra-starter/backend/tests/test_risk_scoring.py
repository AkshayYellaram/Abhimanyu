from app.services.risk_scoring import score_account
from app.api.risk import classify_mule_layer

def test_score_is_bounded_and_explainable():
    result = score_account({
        "rapid_pass_through_ratio": 0.95,
        "distinct_senders": 8,
        "distinct_receivers": 5,
        "terminal_indicators": 1,
        "cycle_detected": True,
    })
    assert 0 <= result["risk_score"] <= 100
    assert result["reasons"]
def test_high_fan_out_receivers_are_accounted_for():
    result = score_account({
        "rapid_pass_through_ratio": 0.0,
        "distinct_senders": 3,
        "distinct_receivers": 12,
        "terminal_indicators": 0,
        "cycle_detected": False,
    })

    # High fan-out should contribute to the score.
    assert result["risk_score"] > 0


def test_layer_classification_for_high_fan_out():
    result = score_account({
        "rapid_pass_through_ratio": 0.0,
        "distinct_senders": 3,
        "distinct_receivers": 12,
        "terminal_indicators": 0,
        "cycle_detected": False,
    })

    # Classification behavior must be explicitly tested.
    assert result["suspected_layer"] == "Unclassified"


def test_distributor_classification_includes_three_to_seven_receivers():
    for receiver_count in (3, 7):
        result = score_account({
            "distinct_senders": 0,
            "distinct_receivers": receiver_count,
        })
        api_result = classify_mule_layer({
            "distinct_senders": 0,
            "distinct_receivers": receiver_count,
        })

        assert result["suspected_layer"] == "L2"
        assert "LAYER_2_DISTRIBUTOR_CANDIDATE" in api_result["classification_candidates"]


def test_eight_receivers_are_not_classified_as_l2():
    features = {
        "distinct_senders": 0,
        "distinct_receivers": 8,
        "terminal_indicators": 0,
    }

    assert score_account(features)["suspected_layer"] == "Unclassified"
    assert "LAYER_2_DISTRIBUTOR_CANDIDATE" not in classify_mule_layer(features)[
        "classification_candidates"
    ]