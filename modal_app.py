"""Runs the buy evals on Modal, on a schedule and on demand.

Deploy once with `modal deploy modal_app.py`. Each run checks out the current `main` of this repository before it
starts, so a merged change is picked up by the next run with no new deploy. A new deploy is needed only when this
file changes.

The keys come from the Modal secret `buy-evals`: ANTHROPIC_API_KEY, AGENTCARD_CLIENT_ID, AGENTCARD_CLIENT_SECRET,
SLACK_BOT_TOKEN, SLACK_EVALS_CHANNEL, BRAINTRUST_API_KEY and, once there is one, AGNOST_ORG_ID.

Run by hand:
    modal run modal_app.py::core         # searches, conversations and the judge's own test
    modal run modal_app.py::everything   # the core set, the coverage matrix and the reviewed real asks
    modal run modal_app.py::purchases    # the cart and checkout evals, one pair per store and supplier, three times each
"""

import subprocess

import modal

REPO = "https://github.com/tiny-agent-company/commerce-sdk-eve-example.git"

# The evals that walk a purchase to its cart or its checkout step. They run once a day, on their own.
PURCHASE_TAGS = ["cart", "checkout", "asked-once", "refused-details"]
PURCHASES = [flag for tag in PURCHASE_TAGS for flag in ("--tag", tag)]
WITHOUT_PURCHASES = [flag for tag in PURCHASE_TAGS for flag in ("--exclude-tag", tag)]

# How long the daily purchases run may take, in seconds. Modal stops a function at its time limit, lets one be set to
# 24 hours at most, and a run it stops reports nothing, since the reports go out when the run ends. So the limit is set
# well above what the run takes: on 2026-11-26 the 127 evals took 29 minutes sent once, six at a time, which is about an
# hour and a half sent three times. Each eval also has a limit of its own (20 minutes for a cart, 30 for a checkout), so
# one store that hangs cannot hold the run. Six hours is four times the measured run. Measure again before adding many
# more stores, or before raising how often each eval is sent.
PURCHASES_TIME_LIMIT = 6 * 60 * 60

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
    """Every six hours: everything but the coverage matrix, the real asks and the cart and checkout evals."""
    run_evals("--exclude-tag", "matrix", "--exclude-tag", "real", *WITHOUT_PURCHASES)


@app.function(image=image, secrets=keys, timeout=3600, cpu=2, memory=4096, retries=0, schedule=modal.Cron("47 13 * * *", timezone="UTC"))
def everything() -> None:
    """Once a day: the core set, the coverage matrix and the reviewed real asks (at most REAL_ASKS_LIMIT of them). The cart
    and checkout evals have a daily run of their own below, because they take much longer."""
    run_evals(*WITHOUT_PURCHASES)


@app.function(image=image, secrets=keys, timeout=PURCHASES_TIME_LIMIT, cpu=2, memory=4096, retries=0, schedule=modal.Cron("17 15 * * *", timezone="UTC"))
def purchases() -> None:
    """Once a day: the cart and checkout evals, each sent three times, so a store that gets through only some of the time
    shows as "passed 2 of 3" and not as a pass or a failure by luck. Each eval is a chat of several messages with a live
    store, and a store's own checkout can take minutes to price a cart, so they run apart from the other evals.

    Six chats run at a time. More at once makes the stores' own checkouts slower and the connection to the chat drop, which
    then reads as flakiness. See PURCHASES_TIME_LIMIT above for how the run fits its time limit."""
    run_evals(*PURCHASES, "--repeat", "3", "--max-concurrency", "6")
