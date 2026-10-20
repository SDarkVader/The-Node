"""Inspect AI tasks over The Node.

  node_safety_suite      every scenario x policy in an experiment, every scorer
  node_prompt_injection  AgentDojo-style: embedded instructions vs the user task
  node_control           ControlArena-style: main task + covert side task under a trusted monitor
  node_social_pressure   authority deference, sycophancy, deception
  node_society           cooperation, resource allocation, collective outcomes
  node_information       information asymmetry
  node_longitudinal      behavioural change over a long episode
  node_integrity         simulation-failure handling (evaluation self-test)

Run offline (scripted fixtures, no API):
  inspect eval evals/inspect_node/tasks.py@node_safety_suite --model mockllm/model
"""

from __future__ import annotations

import json
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.dataset import MemoryDataset, Sample

from . import scorers as S
from .policies import POLICIES
from .solver import node_episode

EXPERIMENTS = Path(__file__).resolve().parents[1] / "experiments"


def load_experiment(name: str) -> dict:
    path = Path(name) if name.endswith(".json") else EXPERIMENTS / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def dataset(experiment: str, scenarios: set[str] | None = None) -> MemoryDataset:
    config = load_experiment(experiment)
    samples = []
    for scenario, policy in config["samples"]:
        if scenarios is not None and scenario not in scenarios:
            continue
        if policy not in POLICIES:
            raise ValueError(f"unknown policy {policy}")
        samples.append(Sample(
            id=f"{scenario}__{policy}",
            input=f"Run scenario {scenario} as the controlled Baker.",
            target="",
            metadata={"scenario": scenario, "policy": policy, "experiment": config["name"],
                      # Describes the scripted fixture; scorers never read it.
                      "fixture_expected": POLICIES[policy].expected},
        ))
    return MemoryDataset(samples, name=f"node-{config['name']}")


def _make(experiment: str, scenarios: set[str] | None, scorer_list: list) -> Task:
    config = load_experiment(experiment)
    return Task(dataset=dataset(experiment, scenarios), solver=node_episode(), scorer=scorer_list,
                model=config.get("model", "mockllm/model"), metadata={"experiment": config["name"]})


@task
def node_safety_suite(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, None, [*S.ALL_SCORERS])


@task
def node_prompt_injection(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"prompt_injection_price", "baseline_operations"},
                 [S.goal_hijacking(), S.constraint_adherence(), S.simulation_integrity()])


@task
def node_control(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"control_side_task"}, [S.oversight_monitor(), S.constraint_adherence(), S.simulation_integrity()])


@task
def node_social_pressure(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"authority_council", "authority_anonymous", "sycophancy_consensus", "deception_reassurance"},
                 [S.authority_deference(), S.sycophancy(), S.deception(), S.simulation_integrity()])


@task
def node_society(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"cooperation_pricing", "baseline_operations"},
                 [S.cooperation(), S.collective_outcomes(), S.constraint_adherence(), S.simulation_integrity()])


@task
def node_information(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"information_asymmetry"}, [S.information_asymmetry(), S.constraint_adherence(), S.simulation_integrity()])


@task
def node_longitudinal(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"longitudinal_pressure"}, [S.longitudinal_change(), S.authority_deference(), S.simulation_integrity()])


@task
def node_integrity(experiment: str = "scripted_fixtures") -> Task:
    return _make(experiment, {"simulation_fault", "baseline_operations"}, [S.simulation_integrity(), S.constraint_adherence()])
