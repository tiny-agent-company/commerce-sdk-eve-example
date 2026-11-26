"""Runs the buy evals on Modal, on a schedule and on demand.

Deploy once with `modal deploy modal_app.py`. Each run checks out the current `main` of this repository before it
starts, so a merged change is picked up by the next run with no new deploy. A new deploy is needed only when this
file changes.

The keys come from the Modal secret `buy-evals`: ANTHROPIC_API_KEY, AGENTCARD_CLIENT_ID, AGENTCARD_CLIENT_SECRET,
SLACK_BOT_TOKEN, SLACK_EVALS_CHANNEL, BRAINTRUST_API_KEY and, once there is one, AGNOST_ORG_ID.

Run by hand:
    modal run modal_app.py::core         # searches, conversations and the judge's own test
    modal run modal_app.py::everything   # the core set, the coverage matrix and the reviewed real asks
"""

import subprocess

import modal

REPO = "https://github.com/tiny-agent-company/commerce-sdk-eve-example.git"

app = modal.App("buy-evals")
image = modal.Image.from_registry("node:24-slim", add_python="3.12").apt_install("git", "ca-certificates")
keys = [modal.Secret.from_name("buy-evals")]


def run_evals(*flags: str) -> None:
    """Checks out main, installs it and runs `eve eval`. An eval that does not pass is reported to Slack and Braintrust by
    the evals themselves (exit code 1), so only a run that breaks fails the function."""
    subprocess.run(["git", "clone", "--depth", "1", REPO, "/evals"], check=True)
    subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd="/evals", check=True)
    result = subprocess.run(["npx", "eve", "eval", "--strict", *flags], cwd="/evals")
    if result.returncode not in (0, 1):
        raise RuntimeError(f"eve eval broke with exit code {result.returncode}")


@app.function(image=image, secrets=keys, timeout=1800, cpu=2, memory=4096, retries=0, schedule=modal.Cron("17 */6 * * *", timezone="UTC"))
def core() -> None:
    """Every six hours: everything but the coverage matrix and the real asks."""
    run_evals("--exclude-tag", "matrix", "--exclude-tag", "real")


@app.function(image=image, secrets=keys, timeout=3600, cpu=2, memory=4096, retries=0, schedule=modal.Cron("47 13 * * *", timezone="UTC"))
def everything() -> None:
    """Once a day: the core set, the coverage matrix and the reviewed real asks (at most REAL_ASKS_LIMIT of them)."""
    run_evals()
