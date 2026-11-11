# CAELUS OS — Project Fluent Offline Message Catalog (English / EN)
# Law A-1 & A-4: Core emits only canonical msg_id + fixed-point parameters;
# switching language or register mutates state_blake3 by 0 bits.

verdict-pass-plain = Safe to Proceed
verdict-pass-technical = VERDICT: PASS · Policy { $policy_id } + state_blake3={ $state_blake3 }

verdict-rule-breach-plain = Safety Rule Breached — Action Required
verdict-rule-breach-technical = VERDICT: RULE_BREACH · Breached rule { $rule_id } (threshold={ $max_allowed_fp } fp)

verdict-insufficient-corroboration-plain = Single-Source Report — Awaiting Confirmation
verdict-insufficient-corroboration-technical = VERDICT: INSUFFICIENT_EVIDENCE · Missing independence_group: { $missing_groups }

epistemic-observation-plain = Direct Sensor Reading
epistemic-observation-technical = EPISTEMIC: OBSERVATION · Calibrated hardware / AIS / NMEA record

epistemic-claim-plain = Reported Statement
epistemic-claim-technical = EPISTEMIC: CLAIM · Human or external authority statement

epistemic-hypothesis-plain = Model Forecast / Estimate
epistemic-hypothesis-technical = EPISTEMIC: HYPOTHESIS · Numerical weather model or agent inference

security-source-equivocation-plain = Security Alert: Conflicting Duplicate From Source (Blocked)
security-source-equivocation-technical = SECURITY_ALERT_EQUIVOCATION · Same ({ $source_id }, seq_no={ $seq_no }), divergent blake3

temporal-bitemporal-plain = Happened At / Received At
temporal-bitemporal-technical = observed_at_ms vs. cutoff_learned_at_ms (No Look-Ahead Slice)

counterfactual-branch-plain = What-If Scenario Simulation
counterfactual-branch-technical = Counterfactual Delta · Isolated branch_state_blake3={ $branch_state_blake3 } diff analysis

explain-outcome-plain = Decision Status: { $verdict_label }. Active safety policy: { $policy_title }. Confirmed independent source groups: { $group_count }. Audit trail verified.
explain-outcome-technical = EXPLAIN_OUTCOME · verdict={ $verdict_code } · rule={ $rule_id } · groups={ $group_count } · state_blake3={ $state_blake3 } · audit_verified={ $audit_verified }
