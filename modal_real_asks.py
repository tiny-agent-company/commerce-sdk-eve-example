"""Picks yesterday's real asks that did not get a good answer and saves them for the `real` evals, once a day on Modal.

The job is real-asks/pick.ts. Each run checks out the current `main` of this repository first, as modal_app.py does.
It is a separate Modal app from the evals so that deploying the evals never depends on this job's keys.

Deploy with `modal deploy modal_real_asks.py`, once the Modal secret `buy-evals-real-asks` exists. It holds where to
read the conversations from, and nothing else needs it:

    REAL_ASKS_EXPORT_URL and REAL_ASKS_EXPORT_TOKEN    an export of the day's conversations served over HTTPS, or
    REAL_ASKS_DATABASE_URL                             a database login that can only read
    REAL_ASKS_SKIP_COMPANIES, REAL_ASKS_SKIP_CLIENTS, REAL_ASKS_SKIP_SHOPPERS
                                                       ids of test traffic to leave out, separated by commas

ANTHROPIC_API_KEY and BRAINTRUST_API_KEY come from the secret `buy-evals`, which the evals already use. Without a
place to read from, a run prints that it skipped and ends well.

Run by hand:
    modal run modal_real_asks.py::pick                      # yesterday
    modal run modal_real_asks.py::pick --day 2026-11-24     # one day
    modal run modal_real_asks.py::pick --dry-run            # the numbers, saving nothing
"""

import subprocess

import modal

REPO = "https://github.com/tiny-agent-company/commerce-sdk-eve-example.git"

app = modal.App("buy-evals-real-asks")
image = modal.Image.from_registry("node:24-slim", add_python="3.12").apt_install("git", "ca-certificates")
keys = [modal.Secret.from_name("buy-evals"), modal.Secret.from_name("buy-evals-real-asks")]


# 14:10 UTC: yesterday is over everywhere in the Americas, and a follow-up sent up to twelve hours after midnight is in.
@app.function(image=image, secrets=keys, timeout=3600, cpu=1, memory=2048, retries=0, schedule=modal.Cron("10 14 * * *", timezone="UTC"))
def pick(day: str = "", dry_run: bool = False) -> None:
    """Once a day: read yesterday's conversations, keep the asks that went badly and save them to Braintrust."""
    subprocess.run(["git", "clone", "--depth", "1", REPO, "/evals"], check=True)
    subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd="/evals", check=True)
    flags = (["--day", day] if day else []) + (["--dry-run"] if dry_run else [])
    subprocess.run(["node", "real-asks/pick.ts", *flags], cwd="/evals", check=True)
