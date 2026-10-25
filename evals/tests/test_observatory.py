import unittest
import json
from unittest.mock import patch
from inspect_ai.model import ChatMessageUser
from inspect_node.solver import scripted_model
from inspect_node.observatory_export import validate_input, DEFINITION


class ObservatoryExportTests(unittest.TestCase):
    def fixture(self):
        return {"snapshot": {"schema": "node-observatory-snapshot-v1", "verification": "replay_verified", "segmentRoot": "root", "cursor": "segment:2:hash", "eventHash": "hash", "phase": "execution", "calls": [{"requestId": "a", "executed": True, "admitted": {}, "tick": 0, "nextTick": 1}]}, "evidence": [{"eventHash": "hash"}]}

    def test_accepts_declared_execution_scope(self):
        self.assertEqual(len(validate_input(self.fixture())["calls"]), 1)
        self.assertIn("not reasoning quality", DEFINITION)

    def test_rejects_unsealed_or_false_execution_join(self):
        for mutate in [lambda d: d["snapshot"].update(segmentRoot=None), lambda d: d["snapshot"]["calls"][0].update(nextTick=2), lambda d: d["snapshot"]["calls"].append(d["snapshot"]["calls"][0])]:
            d = self.fixture()
            mutate(d)
            with self.assertRaises(ValueError):
                validate_input(d)


class OfflineFixtureTests(unittest.IsolatedAsyncioTestCase):
    async def test_scripted_fixture_requires_no_tokenizer_download(self):
        # The default MockLLM usage path previously fetched o200k_base on a fresh host.
        with patch("tiktoken.get_encoding", side_effect=AssertionError("no tokenizer network/cache dependency")):
            # An existing scripted policy with a minimal real policy input.
            prompt = {"tick": 0, "observation": {"self": {"role": "Baker"}, "city": {"people": [], "stations": []}}, "schema": {}, "notices": []}
            # Malformed policy produces prose on tick 0; no world/schema fabrication needed.
            output = await scripted_model("malformed").generate([ChatMessageUser(content=json.dumps(prompt))])
        self.assertEqual(output.usage.total_tokens, 0)
        self.assertEqual(output.metadata["usage_basis"], "offline_scripted_fixture_no_provider_or_billed_tokens")
