#!/usr/bin/env python3
"""Derive D65 CIELAB from Donner-Jensen skin chromophore parameters.

Run through the pinned environment boundary, for example:
  uv run --with colour-science python derive_chromophore_lab.py --lab 0.03 0.7 0.005

Scientific sources (equations are transcribed, not code copied):
- Donner & Jensen, "A Spectral BSSRDF for Shading Human Skin", EGSR 2006,
  equations 3-8 and Table 1: Cm/beta-m/Ch absorption and scattering model.
- Jacques, OMLC News (January 1998), "Skin optics": baseline absorption
  0.244 + 85.3 exp(-(lambda-154)/66.2) cm^-1 and chromophore mixing.
- Jacques, Phys. Med. Biol. 58 (2013) R37-R61, equations 8-11: melanosome
  absorption and the eumelanin/pheomelanin convention.
- Doi, Tanaka & Tominaga, CGIV 2004, equation 1: two finite turbid skin
  layers composed with Kubelka-Munk reflectance/transmittance. Here the dermis
  is the semi-infinite limit specified by Donner & Jensen section 3.5.
- Prahl, OMLC, "Tabulated Molar Extinction Coefficient for Hemoglobin in
  Water": oxy/deoxy data and its documented 150 g/L conversion.
- colour-science 0.4.x datasets: CIE 1931 2 degree CMFs and D65, BSD-3-Clause.

Prahl's page states provenance and download/conversion instructions but no
redistribution licence. It is therefore fetched at derivation time and accepted
only at the pinned SHA-256; it is never stored in this repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any

import colour
import numpy as np


PRAHL_URL = "https://omlc.org/spectra/hemoglobin/summary.html"
PRAHL_SHA256 = "c5b3a312f3c8e135bf69845ba11afa94d92db0a3f784d344d92afcf9dc290c66"
WAVELENGTHS = np.arange(380.0, 781.0, 5.0)
BETA_M = 0.7
CH = 0.005
PARAMETER_RANGES = {"Cm": [0.0, 0.5], "betaM": [0.0, 1.0], "Ch": [0.001, 0.1]}


@lru_cache(maxsize=1)
def fetch_prahl() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fetch and SHA-pin Prahl's non-redistributed oxy/deoxy Hb table."""
    with urllib.request.urlopen(PRAHL_URL, timeout=30) as response:
        raw = response.read()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != PRAHL_SHA256:
        raise RuntimeError(f"Prahl data SHA-256 drift: expected {PRAHL_SHA256}, got {actual}")
    text = raw.decode("ascii", errors="ignore")
    rows = [
        (float(wavelength), float(oxy), float(deoxy))
        for wavelength, oxy, deoxy in re.findall(
            r"^\s*(\d+(?:\.\d+)?)\s+([\d.]+)\s+([\d.]+)\s*$", text, re.MULTILINE
        )
    ]
    if not rows or rows[0][0] > 380 or rows[-1][0] < 780:
        raise RuntimeError("Prahl table did not cover 380-780 nm")
    data = np.asarray(rows, dtype=float)
    return data[:, 0], data[:, 1], data[:, 2]


def km_finite_layer(absorption: np.ndarray, scattering: np.ndarray, thickness_mm: float) -> tuple[np.ndarray, np.ndarray]:
    """Kubelka-Munk diffuse R,T for a homogeneous finite layer."""
    a = 1.0 + absorption / scattering
    b = np.sqrt(np.maximum(a * a - 1.0, 0.0))
    optical_depth = b * scattering * thickness_mm
    denominator = a * np.sinh(optical_depth) + b * np.cosh(optical_depth)
    # The b->0 limit is well behaved but not reached by this sourced model.
    reflectance = np.sinh(optical_depth) / denominator
    transmittance = b / denominator
    return reflectance, transmittance


def spectral_reflectance(Cm: float, beta_m: float, Ch: float) -> np.ndarray:
    """Two-layer KM reflectance on the 380-780 nm, 5 nm grid."""
    for name, value in (("Cm", Cm), ("betaM", beta_m), ("Ch", Ch)):
        lo, hi = PARAMETER_RANGES[name]
        if not lo <= value <= hi:
            raise ValueError(f"{name}={value} outside cited range [{lo}, {hi}]")

    wavelength = WAVELENGTHS
    # Donner & Jensen 2006 equations 3-6, units mm^-1 and wavelength in nm.
    eumelanin = 6.6e10 * wavelength ** -3.33
    pheomelanin = 2.9e14 * wavelength ** -4.75
    baseline = 0.0244 + 8.53 * np.exp(-(wavelength - 154.0) / 66.2)
    epidermis_absorption = Cm * (beta_m * eumelanin + (1.0 - beta_m) * pheomelanin) + (1.0 - Cm) * baseline

    hb_wavelength, oxy_extinction, deoxy_extinction = fetch_prahl()
    oxy = np.interp(wavelength, hb_wavelength, oxy_extinction)
    deoxy = np.interp(wavelength, hb_wavelength, deoxy_extinction)
    # Prahl: mu_a[cm^-1] = 2.303 e * 150[g/L] / 64500[g/mol]. Convert to mm^-1.
    whole_blood_scale = 2.303 * 150.0 / 64500.0 / 10.0
    oxygenation = 0.75  # Donner & Jensen 2006 section 3.4 fixes gamma to 0.75.
    blood_absorption = whole_blood_scale * (oxygenation * oxy + (1.0 - oxygenation) * deoxy)
    dermis_absorption = Ch * blood_absorption + (1.0 - Ch) * baseline

    # Donner & Jensen equation 8; dermal scattering is scaled to 50%.
    epidermis_scattering = 14.74 * wavelength ** -0.22 + 2.2e11 * wavelength ** -4.0
    dermis_scattering = 0.5 * epidermis_scattering

    epidermis_r, epidermis_t = km_finite_layer(
        epidermis_absorption, epidermis_scattering, 0.25
    )
    dermis_a = 1.0 + dermis_absorption / dermis_scattering
    dermis_r_infinite = dermis_a - np.sqrt(np.maximum(dermis_a * dermis_a - 1.0, 0.0))
    # Standard adding equation for a symmetric finite layer over a substrate.
    combined = epidermis_r + epidermis_t**2 * dermis_r_infinite / (
        1.0 - epidermis_r * dermis_r_infinite
    )
    return np.clip(combined, 0.0, 1.0)


def reflectance_to_lab(reflectance: np.ndarray) -> list[float]:
    """Integrate reflectance against CIE 1931 2 degree CMFs and D65."""
    shape = colour.SpectralShape(380, 780, 5)
    cmfs = colour.MSDS_CMFS["CIE 1931 2 Degree Standard Observer"].copy().align(shape)
    d65 = colour.SDS_ILLUMINANTS["D65"].copy().align(shape)
    cmf_values = np.asarray(cmfs.values, dtype=float)
    illuminant = np.asarray(d65.values, dtype=float)
    normalization = float(np.sum(illuminant * cmf_values[:, 1]))
    xyz = 100.0 * np.sum(
        reflectance[:, np.newaxis] * illuminant[:, np.newaxis] * cmf_values, axis=0
    ) / normalization
    d65_xy = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"]
    lab = colour.XYZ_to_Lab(xyz / 100.0, d65_xy)
    return [float(channel) for channel in lab]


def derive_lab(Cm: float, beta_m: float, Ch: float) -> list[float]:
    return reflectance_to_lab(spectral_reflectance(Cm, beta_m, Ch))


def solve_cm(target_l: float, beta_m: float = BETA_M, Ch: float = CH) -> tuple[float, list[float]]:
    """Bisection on monotone L*, retaining the cited fixed beta-m and Ch."""
    low, high = PARAMETER_RANGES["Cm"]
    low_lab = derive_lab(low, beta_m, Ch)
    high_lab = derive_lab(high, beta_m, Ch)
    if not high_lab[0] <= target_l <= low_lab[0]:
        raise ValueError(
            f"target L* {target_l} outside model span [{high_lab[0]}, {low_lab[0]}]"
        )
    for _ in range(60):
        midpoint = (low + high) / 2.0
        lab = derive_lab(midpoint, beta_m, Ch)
        if lab[0] > target_l:
            low = midpoint
        else:
            high = midpoint
    Cm = (low + high) / 2.0
    return Cm, derive_lab(Cm, beta_m, Ch)


def calibrate(tone_report_path: Path) -> dict[str, Any]:
    tone = json.loads(tone_report_path.read_text(encoding="utf8"))
    inputs = [
        ("anchor:warm_light", tone["tone_anchors_Lab"]["warm_light"]),
        ("anchor:warm_medium", tone["tone_anchors_Lab"]["warm_medium"]),
        ("family:young:forehead", tone["families"]["young"]["forehead"]),
        ("family:middle:forehead", tone["families"]["middle"]["forehead"]),
        ("family:old:forehead", tone["families"]["old"]["forehead"]),
    ]
    points = []
    for identifier, measured in inputs:
        Cm, derived = solve_cm(float(measured[0]))
        miss = math.dist(measured, derived)
        points.append(
            {
                "id": identifier,
                "measuredLab": measured,
                "derivedLab": derived,
                "Cm": Cm,
                "dE76": miss,
            }
        )
    return {"betaM": BETA_M, "Ch": CH, "knownGood": points}


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--lab", nargs=3, type=float, metavar=("CM", "BETA_M", "CH"))
    group.add_argument("--spectrum", nargs=3, type=float, metavar=("CM", "BETA_M", "CH"))
    group.add_argument("--calibrate", type=Path, metavar="TONE_REPORT_JSON")
    args = parser.parse_args()
    if args.lab is not None:
        print(json.dumps(derive_lab(*args.lab), separators=(",", ":")))
    elif args.spectrum is not None:
        reflectance = spectral_reflectance(*args.spectrum)
        print(
            json.dumps(
                {"wavelengthNm": WAVELENGTHS.tolist(), "reflectance": reflectance.tolist()},
                separators=(",", ":"),
            )
        )
    else:
        print(json.dumps(calibrate(args.calibrate), indent=2))


if __name__ == "__main__":
    main()
