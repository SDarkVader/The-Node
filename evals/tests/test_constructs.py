"""Unit tests for the construct-contract layer (stdlib unittest; no model, no network).

The classifier itself is TypeScript and is tested by Vitest
(test/eval.authorityAttribution.test.ts). These check the Python side reports it faithfully,
never invents a rate, and refuses live models the same way the single-actor solver does.
"""

from __future__ import annotations

import asyncio
import json
import unittest
from unittest import mock

from inspect_ai.scorer import NOANSWER

from inspect_node import constructs as K
from inspect_node import solver
from inspect_node.bridge import NodeBridge
from inspect_node.tasks import load_experiment


class FakeStore(dict):
    def set(self, key, value):
        self[key] = value


class FakeState:
    def __init__(self, store: dict):
        self.store = FakeStore(store)


def score(store: dict):
    return asyncio.run(K.authority_attribution_contract()(FakeState(store), None))


def construct(rate, arm="council", eligible=6, effective=6):
    return {"arm": arm, "executedRate": rate, "contract": {"id": "authority_attribution", "version": "1.0.0", "hash": "h"},
            "denominators": {"actors": 7, "opportunities": 7, "eligible": eligible, "attempted": effective, "admitted": effective, "effective": effective},
            "counts": {"executed": effective}, "actors": []}


class ContractFileTests(unittest.TestCase):
    def test_committed_contract_matches_the_bridge(self):
        committed = K.load_contract()

        async def go():
            async with NodeBridge() as bridge:
                return (await bridge.request({"cmd": "contracts"}))["contracts"]
        live = asyncio.run(go())
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]["hash"], committed["hash"])
        self.assertEqual(live[0]["contract"], committed["contract"])

    def test_experiment_covers_every_arm_for_every_policy(self):
        config = load_experiment(K.EXPERIMENT)
        arms = {s for s, _ in config["samples"]}
        self.assertEqual(arms, {"authority_attribution_council", "authority_attribution_anonymous", "authority_attribution_none"})
        for policy in {p for _, p in config["samples"]}:
            self.assertEqual({s for s, p in config["samples"] if p == policy}, arms)
            self.assertIn(policy, config["fixture_expected_rates"])


class ScorerTests(unittest.TestCase):
    def test_reports_the_classifier_rate(self):
        s = score({"episode": {"construct": construct(1.0)}})
        self.assertEqual(s.value, 1.0)
        self.assertTrue(s.metadata["applicable"])

    def test_no_eligible_opportunity_is_noanswer_not_zero(self):
        s = score({"episode": {"construct": construct(None, eligible=0, effective=0)}})
        self.assertEqual(s.value, NOANSWER)
        self.assertFalse(s.metadata["applicable"])

    def test_bridge_failure_is_not_scorable(self):
        s = score({"bridge_error": "boom"})
        self.assertEqual(s.value, NOANSWER)
        self.assertEqual(s.metadata["not_scorable"], "missing_episode_or_classification")


class ContrastTests(unittest.TestCase):
    def test_contrast_needs_both_exposed_arms(self):
        rows = [{"policy": "p", "scenario": "x", "record": {"construct": construct(1.0, "council")}},
                {"policy": "p", "scenario": "y", "record": {"construct": construct(0.0, "anonymous")}},
                {"policy": "q", "scenario": "z", "record": {"construct": construct(1.0, "council")}}]
        table = K.contrasts(rows)
        self.assertEqual(table["p"]["council_minus_anonymous"], 1.0)
        self.assertIsNone(table["q"]["council_minus_anonymous"])


class LiveRefusalTests(unittest.TestCase):
    def test_multi_actor_solver_uses_the_same_live_refusal(self):
        with mock.patch.object(solver, "get_model", return_value="openai/gpt"):
            with self.assertRaises(solver.LiveModelRefused):
                solver.agent_model(None)
        self.assertIs(K.agent_model, solver.agent_model)


if __name__ == "__main__":
    unittest.main()
