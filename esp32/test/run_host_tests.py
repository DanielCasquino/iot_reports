#!/usr/bin/env python3
"""Compile the real controller headers with fake peripherals; no serial/network."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
compiler = os.environ.get("CXX", "g++")
with tempfile.TemporaryDirectory(prefix="heater-host-") as folder:
    for name in ("controller", "power_contract", "power_observation", "wake_verification", "temperature_adjustment", "display_mirror", "peripherals"):
        target = Path(folder) / name
        subprocess.run([compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        "-I" + str(root / "fakes"), "-I" + str(root.parent / "include"),
                        str(root / (name + "_test.cpp")), "-o", str(target)], check=True)
        subprocess.run([str(target)], check=True)
        print(name + ": PASS", flush=True)
    for mode in (0, 1):
        target = Path(folder) / ("probe-" + str(mode))
        subprocess.run([compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        "-DTEMPORARY_SENSOR_TEST_MODE=" + str(mode),
                        "-I" + str(root / "fakes"), "-I" + str(root.parent / "include"),
                        str(root / "temperature_probe_test.cpp"), "-o", str(target)], check=True)
        subprocess.run([str(target)], check=True)
        print("temperature mode " + str(mode) + ": PASS", flush=True)
