"""Runs the buy evals on Modal, on a schedule and on demand.

Deploy once with `modal deploy modal_app.py`. Each run checks out the current `main` of this repository before it
starts, so a merged change is picked up by the next run with no new deploy. A new deploy is needed only when this
file changes.

The keys come from the Modal secret `buy-evals`: ANTHROPIC_API_KEY, AGENTCARD_CLIENT_ID, AGENTCARD_CLIENT_SECRET,
SLACK_BOT_TOKEN, SLACK_EVALS_CHANNEL and BRAINTRUST_API_KEY. No eval run sends anything to Agnost: the runs below start
without Agnost's variable, whatever the secret holds.

Run by hand:
    modal run modal_app.py::core         # searches, conversations and the judge's own test
    modal run modal_app.py::everything   # the core set, the coverage matrix and the reviewed real asks
    modal run modal_app.py::purchases    # the cart and checkout evals, one pair per store and supplier, three times each
"""

import os
import subprocess

import modal

REPO = "https://github.com/tiny-agent-company/commerce-sdk-eve-example.git"

# The evals that walk a purchase to its cart or its checkout step. They run once a day, on their own.
PURCHASE_TAGS = ["cart", "checkout", "asked-once", "refused-details", "store-account"]
PURCHASES = [flag for tag in PURCHASE_TAGS for flag in ("--tag", tag)]
WITHOUT_PURCHASES = [flag for tag in PURCHASE_TAGS for flag in ("--exclude-tag", tag)]

# The store-account evals run as the one test shopper the store test accounts are saved for (evals/lib/store-accounts.ts),
# in a run of their own, so every other purchase chat stays a shopper of its own with no account anywhere.
ACCOUNT_SHOPPER = "evals-store-accounts"

# How long the daily purchases run may take, in seconds. Modal stops a function at its time limit, lets one be set to
# 24 hours at most, and a run it stops reports nothing, since the reports go out when the run ends. So the limit is set
# well above what the run takes: on 2026-11-26 the 127 evals took 31 minutes sent once and 102 minutes sent three times,
# six at a time. Since 2026-11-27 no more than two chats run at once (below), which makes the run about three times as
# long: about five hours. Each run of an eval also has a limit of its own (20 minutes for a cart, 30 for a checkout), so
# one store that hangs cannot hold the run. Twelve hours leaves room for that. Measure again before adding many more
# stores, or before raising how often each eval is sent.
PURCHASES_TIME_LIMIT = 12 * 60 * 60

# How many runs of the purchase evals eve holds at once. The three runs of one eval go one after another, never side by
# side, and no more than two purchase chats run at once in all (evals/lib/one-after-another.ts): a supplier that prices
# one order at a time made later runs of an eval wait behind the first, and store sign-ins in hosted browsers failed when
# several ran together (2026-11-27). A run waiting its turn uses nothing, so eve holds a few more than the two that chat.
PURCHASES_HELD_AT_ONCE = 6

app = modal.App("buy-evals")
image = modal.Image.from_registry("node:24-slim", add_python="3.12").apt_install("git", "ca-certificates")
keys = [modal.Secret.from_name("buy-evals")]


def run_evals(*flags: str, shopper: str | None = None) -> None:
    """Checks out main, installs it and runs `eve eval`. An eval that does not pass is reported to Slack and Braintrust by
    the evals themselves (exit code 1), so only a run that breaks fails the function. With `shopper`, every chat of the run
    is that one test shopper (EVAL_SHOPPER_ID, agent/tools/buy.ts)."""
    if not os.path.isdir("/evals"):
        subprocess.run(["git", "clone", "--depth", "1", REPO, "/evals"], check=True)
        subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd="/evals", check=True)
    # The example app records conversations in Agnost when AGNOST_ORG_ID is set. Eval chats are not shoppers, so they never go there.
    env = {key: value for key, value in os.environ.items() if not key.startswith("AGNOST_") and key != "EVAL_SHOPPER_ID"}
    if shopper:
        env["EVAL_SHOPPER_ID"] = shopper
    result = subprocess.run(["npx", "eve", "eval", "--strict", *flags], cwd="/evals", env=env)
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
    """Once a day: the cart and checkout evals, each sent three times, one run after another, so a store that gets through
    only some of the time shows as "passed 2 of 3" and not as a pass or a failure by luck. Each eval is a chat of several
    messages with a live store, and a store's own checkout can take minutes to price a cart, so they run apart from the
    other evals.

    No more than two chats run at a time. More at once makes the stores' own checkouts slower, the connection to the chat
    drop and store sign-ins fail, which then reads as flakiness. See PURCHASES_HELD_AT_ONCE and PURCHASES_TIME_LIMIT
    above. The store-account evals run last, in a run of their own, as the test shopper the store accounts are saved for."""
    held = ["--repeat", "3", "--max-concurrency", str(PURCHASES_HELD_AT_ONCE)]
    run_evals(*PURCHASES, "--exclude-tag", "store-account", *held)
    run_evals("--tag", "store-account", *held, shopper=ACCOUNT_SHOPPER)
