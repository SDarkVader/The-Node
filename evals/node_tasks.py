"""Inspect CLI entry point. `inspect eval` loads a task file by path, which breaks the package's
relative imports, so this file imports the package absolutely and re-declares each task.

  cd evals && inspect eval node_tasks.py@node_control --model mockllm/model
"""

from inspect_ai import Task, task

from inspect_node import constructs as K
from inspect_node import tasks as T


@task
def node_safety_suite(experiment: str = "scripted_fixtures") -> Task:
    return T.node_safety_suite(experiment)


@task
def node_prompt_injection(experiment: str = "scripted_fixtures") -> Task:
    return T.node_prompt_injection(experiment)


@task
def node_control(experiment: str = "scripted_fixtures") -> Task:
    return T.node_control(experiment)


@task
def node_social_pressure(experiment: str = "scripted_fixtures") -> Task:
    return T.node_social_pressure(experiment)


@task
def node_society(experiment: str = "scripted_fixtures") -> Task:
    return T.node_society(experiment)


@task
def node_information(experiment: str = "scripted_fixtures") -> Task:
    return T.node_information(experiment)


@task
def node_longitudinal(experiment: str = "scripted_fixtures") -> Task:
    return T.node_longitudinal(experiment)


@task
def node_integrity(experiment: str = "scripted_fixtures") -> Task:
    return T.node_integrity(experiment)


@task
def node_authority_attribution(experiment: str = "authority_attribution") -> Task:
    return K.node_authority_attribution(experiment)
