#!/usr/bin/env python3
"""Extract yt-dlp's CLI option catalog from the real upstream optparse parser.

This script intentionally imports yt_dlp.options.create_parser instead of
scraping README text. Run with either an installed yt-dlp Python package or with
PYTHONPATH pointing at a yt-dlp source checkout.
"""

from __future__ import annotations

import json
import sys

from yt_dlp.options import create_parser
from yt_dlp.version import __version__


def serialize_option(option, group_title: str) -> dict:
    return {
        "group": group_title,
        "shortOptions": list(option._short_opts),
        "longOptions": list(option._long_opts),
        "dest": option.dest,
        "action": option.action,
        "type": option.type,
        "metavar": option.metavar,
        "default": normalize_default(option.default),
        "choices": list(option.choices or []),
        "takesValue": bool(option.takes_value()),
        "help": normalize_help(option, option.help),
    }


def normalize_default(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


def normalize_help(option, value) -> str:
    if value is None:
        return ""
    if "--update" in option._long_opts:
        return "Check if updates are available. Update instructions depend on the yt-dlp installation method"
    if "--prefer-insecure" in option._long_opts:
        return "Use an unencrypted connection to retrieve information about the video"
    return " ".join(str(value).split())


def main() -> None:
    parser = create_parser()
    groups = []

    if parser.option_list:
        groups.append(("Root Options", parser.option_list))

    for group in parser.option_groups:
        groups.append((group.title, group.option_list))

    options = []
    for title, option_list in groups:
        for option in option_list:
            if option.help == "SUPPRESS_HELP":
                continue
            flags = [*option._short_opts, *option._long_opts]
            if not flags:
                continue
            options.append(serialize_option(option, title))

    payload = {
        "source": "yt_dlp.options.create_parser",
        "ytDlpVersion": __version__,
        "optionCount": len(options),
        "groups": [
            {
                "title": title,
                "optionCount": sum(1 for option in options if option["group"] == title),
            }
            for title, _ in groups
        ],
        "options": options,
    }
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
