
from datetime import datetime, timezone


def generate_case_report(victim_account: str, trace: dict):
    """
    Create a deterministic investigation draft using only trace evidence.
    No AI-generated factual claims or automatic freeze decisions are made.
    """
    transactions = trace.get("transactions", [])
    total_traced_value = sum(
        float(transaction.get("amount") or 0)
        for transaction in transactions
    )
    direct_victim_outflow = sum(
        float(transaction.get("amount") or 0)
        for transaction in transactions
        if transaction.get("hop") == 1
        and transaction.get("sender_account") == victim_account
    )

    layers = {}
    downstream_accounts = {}
    evidence_rows = []
    hop_summaries = {}
    technical_metadata = []
    layer_accounts = {}
    trace_senders = set()

    for transaction in transactions:
        hop = transaction.get("hop")
        amount = float(transaction.get("amount") or 0)
        evidence = {
            "transaction_id": transaction.get("transaction_id"),
            "sender_account": transaction.get("sender_account"),
            "receiver_account": transaction.get("receiver_account"),
            "amount": transaction.get("amount"),
            "timestamp": transaction.get("timestamp"),
            "hop": hop,
            "sender_ifsc": transaction.get("sender_ifsc"),
            "receiver_ifsc": transaction.get("receiver_ifsc"),
        }

        layers.setdefault(hop, []).append(evidence)
        evidence_rows.append(evidence)
        sender = transaction.get("sender_account")
        receiver = transaction.get("receiver_account")
        if sender:
            trace_senders.add(sender)
        if receiver and receiver != victim_account:
            layer_key = (hop, receiver)
            layer_account = layer_accounts.setdefault(
                layer_key,
                {
                    "layer": hop,
                    "account_id": receiver,
                    "beneficiary_ifsc": transaction.get("receiver_ifsc"),
                    "observed_incoming_amount_inr": 0.0,
                    "first_observed_at": transaction.get("timestamp"),
                    "last_observed_at": transaction.get("timestamp"),
                    "transaction_ids": [],
                },
            )
            layer_account["observed_incoming_amount_inr"] += amount
            timestamp = transaction.get("timestamp")
            if timestamp:
                layer_account["first_observed_at"] = min(
                    filter(None, [layer_account["first_observed_at"], timestamp])
                )
                layer_account["last_observed_at"] = max(
                    filter(None, [layer_account["last_observed_at"], timestamp])
                )
            transaction_id = transaction.get("transaction_id")
            if transaction_id and transaction_id not in layer_account["transaction_ids"]:
                layer_account["transaction_ids"].append(transaction_id)

        if transaction.get("ip_address") or transaction.get("device_type"):
            technical_metadata.append({
                "transaction_id": transaction.get("transaction_id"),
                "ip_address": transaction.get("ip_address"),
                "device_type": transaction.get("device_type"),
            })

        hop_summary = hop_summaries.setdefault(
            hop,
            {"step": hop, "transactions": 0, "total_amount_inr": 0},
        )
        hop_summary["transactions"] += 1
        hop_summary["total_amount_inr"] += amount

        if receiver and receiver != victim_account:
            downstream_accounts.setdefault(
                receiver,
                {
                    "account_id": receiver,
                    "observed_in_transactions": 0,
                    "transaction_ids": [],
                    "hops_observed": [],
                },
            )

            item = downstream_accounts[receiver]
            item["observed_in_transactions"] += 1

            transaction_id = transaction.get("transaction_id")
            if transaction_id and transaction_id not in item["transaction_ids"]:
                item["transaction_ids"].append(transaction_id)

            if hop is not None and hop not in item["hops_observed"]:
                item["hops_observed"].append(hop)

    evidence_rows.sort(
        key=lambda item: (
            item["timestamp"] or "",
            item["transaction_id"] or "",
        )
    )

    bank_requisitions = {}
    chronological_narrative = []
    for sequence, evidence in enumerate(evidence_rows, start=1):
        receiver_ifsc = evidence.get("receiver_ifsc") or "UNAVAILABLE"
        bank_package = bank_requisitions.setdefault(
            receiver_ifsc,
            {
                "recipient_placeholder": (
                    "Nodal Officer — verify bank identity and contact details "
                    f"for IFSC {receiver_ifsc}"
                ),
                "beneficiary_ifsc": receiver_ifsc,
                "accounts_for_review": {},
                "supporting_transactions": [],
            },
        )
        receiver = evidence.get("receiver_account")
        if receiver:
            bank_package["accounts_for_review"].setdefault(
                receiver,
                {
                    "account_id": receiver,
                    "beneficiary_ifsc": receiver_ifsc,
                    "transaction_ids": [],
                },
            )
            if evidence.get("transaction_id"):
                bank_package["accounts_for_review"][receiver][
                    "transaction_ids"
                ].append(evidence["transaction_id"])
        bank_package["supporting_transactions"].append(evidence)

        chronological_narrative.append({
            "sequence": sequence,
            "statement": (
                f"Transfer {evidence.get('transaction_id') or 'reference unavailable'} "
                f"(hop {evidence.get('hop') if evidence.get('hop') is not None else 'not recorded'}) was recorded on "
                f"{evidence.get('timestamp') or 'a time not recorded'}: account "
                f"{evidence.get('sender_account') or 'not recorded'} sent INR "
                f"{evidence.get('amount') if evidence.get('amount') is not None else 'an amount not recorded'} "
                f"to account {evidence.get('receiver_account') or 'not recorded'}."
            ),
            "evidence_transaction_ids": (
                [evidence["transaction_id"]]
                if evidence.get("transaction_id")
                else []
            ),
            "generated_from_database_fields_only": True,
        })

    for bank_package in bank_requisitions.values():
        bank_package["accounts_for_review"] = list(
            bank_package["accounts_for_review"].values()
        )

    generated_at = datetime.now(timezone.utc).isoformat()
    truncated = bool(trace.get("truncated", False))
    accounts_by_layer = [
        {
            **account,
            "observed_incoming_amount_inr": round(
                account["observed_incoming_amount_inr"], 2
            ),
            "classification": "Observed receiving account — not a verified mule label",
        }
        for _, account in sorted(
            layer_accounts.items(),
            key=lambda item: (
                item[0][0] is None,
                item[0][0] if item[0][0] is not None else 0,
                item[0][1],
            ),
        )
    ]
    deepest_observed_hop = max(
        (hop for hop, _ in layer_accounts if isinstance(hop, int)),
        default=None,
    )
    potential_holding_accounts = [
        {
            **account,
            "status": "POTENTIAL TRACE LEAF — CURRENT HOLDING NOT VERIFIED",
            "basis": (
                "A receiving account at the deepest observed hop with no "
                "outgoing transfer present in the returned trace."
            ),
            "current_balance_inr": None,
            "recommended_review": (
                "Prioritize for immediate competent-authority review of "
                "preservation or account restraint after bank verification of "
                "current status and available balance. Any restraint requires "
                "independent statutory grounds and required approval."
            ),
        }
        for account in accounts_by_layer
        if account["layer"] == deepest_observed_hop
        and account["account_id"] not in trace_senders
    ]

    plain_language_summary = [
        f"The records show {len(transactions)} transfers in this account trace.",
        (
            f"The records show INR {direct_victim_outflow:,.2f} sent directly "
            "from the account being reviewed."
        ),
        (
            f"The total value of all transfers shown is INR "
            f"{total_traced_value:,.2f}. The same money may appear more than "
            "once if it moved through several accounts."
        ),
        (
            "The records do not confirm the total money lost or the current "
            "balances of any accounts."
        ),
    ]
    if truncated:
        plain_language_summary.append(
            "The trace reached its record limit. More transfers or accounts "
            "may be missing."
        )

    case_diary = {
        "document_type": "Easy-read draft case diary — review before use",
        "generated_at_utc": generated_at,
        "victim_account": victim_account,
        "case_details": {
            "case_reference": f"ABHIMANYU-{victim_account}",
            "fir_or_complaint_number": None,
            "police_station_or_unit": None,
            "investigating_officer_name_rank": None,
            "complainant_reported_loss_inr": None,
            "verified_reported_loss_inr": None,
            "completion_note": (
                "Complete from the FIR/complaint and verify the reported loss "
                "against supporting documents."
            ),
        },
        "transactions_in_trace": len(transactions),
        "plain_language_summary": plain_language_summary,
        "accounts_by_layer": accounts_by_layer,
        "potential_holding_accounts": potential_holding_accounts,
        "chart_data": {
            "transfers_by_step": [
                {
                    **summary,
                    "total_amount_inr": round(summary["total_amount_inr"], 2),
                }
                for _, summary in sorted(
                    hop_summaries.items(),
                    key=lambda item: (
                        item[0] is None,
                        item[0] if item[0] is not None else 0,
                    ),
                )
            ],
        },
        "technical_metadata_by_transaction": technical_metadata,
        "observed_direct_victim_outflow_inr": round(
            direct_victim_outflow, 2
        ),
        "reported_victim_loss_inr": None,
        "confirmed_victim_loss_inr": None,
        "loss_assessment_note": (
            "The dataset does not contain an independently verified victim "
            "loss amount. Direct outflow is the sum of returned hop-1 debits; "
            "it must not be represented as confirmed loss without verification."
        ),
        "verified_remaining_balances_inr": None,
        "sum_of_traced_transaction_values_inr": round(
            total_traced_value, 2
        ),
        "value_summary_note": (
            "These figures come from the records shown here. Money may be "
            "counted again when it moves between accounts. The records do "
            "not confirm the actual loss or current account balances."
        ),
        "warning": (
            "This sum may count the same funds at multiple hops; it is not "
            "the unique amount siphoned or the current account balance."
        ),
        "layers_by_hop": layers,
        "chronological_narrative": chronological_narrative,
        "narrative_generation": {
            "mode": "deterministic_database_template",
            "local_llm_used": False,
            "transaction_narration_used_as_instruction": False,
        },
        "truncated": truncated,
        "evidence_limitations": [
            "This report includes only the transfers returned by this trace.",
            "If the trace reached its limit, it may leave out transfers and accounts.",
            "A transfer link does not prove who owns an account or whether a crime occurred.",
            "The same money may be counted more than once as it moves between accounts.",
            "An IP address in a record does not confirm a person's physical location or identity.",
        ],
        "legal_notice_status": (
            "Not generated as an issued notice. Confirm applicable law and "
            "wording with authorized police and legal personnel."
        ),
        "review_required": True,
    }

    freeze_requisition = {
        "document_type": (
            "Draft bank transaction-record preservation and account-review requisition"
        ),
        "generated_at_utc": generated_at,
        "status": "DRAFT — NOT SENT",
        "subject_account_under_investigation": victim_account,
        "legal_basis": {
            "records_production": (
                "Section 94 BNSS, 2023 (or Section 91 CrPC where applicable); "
                "issuing authority must verify current applicability and cite "
                "the correct provision. This is a records-production reference."
            ),
            "account_restraint": (
                "Section 94 BNSS / Section 91 CrPC is not cited here as a "
                "standalone account-freeze power. The issuing authority must "
                "identify the separate applicable statutory provision, "
                "recorded grounds, and competent approval. This template does "
                "not itself authorize a freeze."
            ),
            "review_required": True,
        },
        "recipient": {
            "designation": "Nodal Officer",
            "bank_name": "Verify from IFSC / official bank directory",
            "official_address": "To be completed by issuing authority",
        },
        "subject": (
            "Request for preservation and production of specified transaction "
            "records; urgent account-status verification and lawful action "
            "only if separately authorized"
        ),
        "reported_victim_loss_inr": None,
        "observed_direct_victim_outflow_inr": round(direct_victim_outflow, 2),
        "confirmed_victim_loss_inr": None,
        "potential_holding_accounts": potential_holding_accounts,
        "accounts_for_authorized_review": list(
            downstream_accounts.values()
        ),
        "supporting_transaction_evidence": evidence_rows,
        "requisitions_by_beneficiary_ifsc": bank_requisitions,
        "trace_truncated": truncated,
        "requested_action_template": [
            "Preserve and produce the specifically identified transaction, "
            "account-status, and relevant KYC/audit records under the legal "
            "authority cited in the issued notice.",
            "Urgently verify whether any listed account currently holds "
            "available funds; report the bank-verified balance and the "
            "as-of timestamp. The trace amount is not a current balance.",
            "Do not impose a debit freeze or other restraint solely on this "
            "draft. If the issuing authority records independent statutory "
            "grounds and obtains required approval, take only the action "
            "specified in the formally issued order.",
            "Record the action taken, legal authority, reference number, "
            "and time of execution.",
        ],
        "required_before_submission": [
            "Investigating authority and official contact details",
            "Case / complaint / FIR reference, as applicable",
            "Verified statutory provision for record production",
            "Separate statutory provision, reasons, and approval for any account restraint",
            "Verified bank name, branch, and account details",
            "Authorized officer signature and submission reference",
        ],
        "safeguards": [
            "No bank name, account holder identity, or legal authority is "
            "inferred from an account ID or IFSC code.",
            "An account appearing in the trace is not proof of wrongdoing.",
            "No current balance or holding is established by this trace.",
            "No freeze request has been sent and no account has been frozen.",
            "A truncated trace may omit relevant downstream accounts.",
        ],
        "review_required": True,
    }

    return {
        **case_diary,
        "freeze_requisition_draft": freeze_requisition,
    }