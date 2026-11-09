#!/usr/bin/env python3
"""Derive D65 CIELAB from sourced skin chromophore parameters.

Run through the pinned environment boundary, for example:
  uv run --with colour-science python derive_chromophore_lab.py --lab 0.03 0.7 0.005

Scientific sources (equations are transcribed, not code copied):
- Donner & Jensen, "A Spectral BSSRDF for Shading Human Skin", EGSR 2006,
  equations 3-8 and Table 1: Cm/beta-m/Ch absorption and scattering model.
- Jacques, OMLC News (January 1998), "Skin optics": baseline absorption
  0.244 + 85.3 exp(-(lambda-154)/66.2) cm^-1 and chromophore mixing.
- Jacques, Phys. Med. Biol. 58 (2013) R37-R61, equations 8-11: melanosome
  absorption and the eumelanin/pheomelanin convention.
- Doi, Tanaka & Tominaga, CGIV 2004, equation 1: finite turbid layers composed
  with Kubelka-Munk reflectance/transmittance; the dermis is semi-infinite.
- Sardar et al., Lasers Med Sci 24 (2009), equation 9: the radiative-transfer
  coefficients are mapped to KM coefficients as K=2*mu_a and
  S=3/4*mu_s' - 1/40*mu_a. Passing mu_a and mu_s' directly as K and S is not
  dimensionally sufficient and made the r1 model blood-blind.
- Yudovsky & Pilon, J Biophotonics (2010), Table 2: 0.0601 mm epidermal
  thickness for the white-subject inner-forearm in-vivo control geometry.
- Cooksey, Allen & Tsai, J Res NIST 122 (2017), dataset DOI 10.18434/M38597:
  in-vivo inner-forearm directional-hemispherical reflectance control and
  instrument uncertainty. The public-domain NIST data are fetched and SHA-pinned.
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
NIST_URL = "https://opendata.nist.gov/1832_Data_JResNIST_skinrefl%20v3.txt"
NIST_SHA256 = "ce9aac735d9d83b4b874b98d45f1ebda682cdc0e652f804efe00ab2fce0c25d9"
WAVELENGTHS = np.arange(380.0, 781.0, 5.0)
PARAMETER_RANGES = {"Cm": [0.0, 0.5], "betaM": [0.0, 1.0], "Ch": [0.001, 0.1]}
EPIDERMIS_THICKNESS_MM = 0.0601


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


@lru_cache(maxsize=1)
def fetch_nist_control() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return NIST subject 15 and population SD from the SHA-pinned public data."""
    request = urllib.request.Request(NIST_URL, headers={"User-Agent": "OpenClinXR-research/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != NIST_SHA256:
        raise RuntimeError(f"NIST data SHA-256 drift: expected {NIST_SHA256}, got {actual}")
    lines = raw.decode("latin1").splitlines()[8:]
    rows = []
    for line in lines:
        fields = line.split(",")
        try:
            wavelength = float(fields[0])
        except (ValueError, IndexError):
            continue
        if len(fields) < 401:
            continue
        subject_averages = np.asarray([float(fields[4 + subject * 4]) for subject in range(100)])
        rows.append((wavelength, subject_averages))
    if not rows:
        raise RuntimeError("NIST control data contained no spectra")
    wavelength = np.asarray([row[0] for row in rows])
    subjects = np.asarray([row[1] for row in rows])
    # Subject 15 is the spectrum with the smallest spectral angle to the population
    # mean on 450-650 nm. This objective selection is made before fitting the model.
    control = subjects[:, 14]
    population_sd = np.std(subjects, axis=1, ddof=1)
    return wavelength, control, population_sd


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


def km_coefficients(absorption: np.ndarray, reduced_scattering: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Map radiative-transfer mu_a, mu_s' to KM K,S (Sardar et al. 2009 eq. 9)."""
    K = 2.0 * absorption
    S = 0.75 * reduced_scattering - 0.025 * absorption
    if np.any(S <= 0):
        raise ValueError("KM scattering coefficient must remain positive")
    return K, S


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

    epidermis_k, epidermis_s = km_coefficients(epidermis_absorption, epidermis_scattering)
    dermis_k, dermis_s = km_coefficients(dermis_absorption, dermis_scattering)
    epidermis_r, epidermis_t = km_finite_layer(
        epidermis_k, epidermis_s, EPIDERMIS_THICKNESS_MM
    )
    dermis_a = 1.0 + dermis_k / dermis_s
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


def fit_control() -> dict[str, Any]:
    """Fit only D&J chromophore parameters to the preselected NIST control."""
    source_wavelength, source_reflectance, source_population_sd = fetch_nist_control()
    sample_wavelength = np.arange(450.0, 651.0, 10.0)
    measured = np.interp(sample_wavelength, source_wavelength, source_reflectance)

    def error(parameters: np.ndarray) -> float:
        predicted = np.interp(sample_wavelength, WAVELENGTHS, spectral_reflectance(*parameters))
        return float(np.sqrt(np.mean(np.square(predicted - measured))))

    best_p = None
    best_error = math.inf
    for Cm in np.linspace(0.0, 0.5, 26):
        for beta_m in np.linspace(0.0, 1.0, 11):
            for Ch in np.geomspace(0.001, 0.1, 13):
                candidate = np.asarray([Cm, beta_m, Ch])
                candidate_error = error(candidate)
                if candidate_error < best_error:
                    best_p, best_error = candidate, candidate_error
    scales = np.asarray([0.02, 0.1, 0.3])
    lower = np.asarray([0.0, 0.0, 0.001])
    upper = np.asarray([0.5, 1.0, 0.1])
    for _ in range(8):
        for axis in range(3):
            for offset in np.linspace(-1.0, 1.0, 21):
                candidate = best_p.copy()
                if axis < 2:
                    candidate[axis] += offset * scales[axis]
                else:
                    candidate[axis] *= math.exp(offset * scales[axis])
                candidate = np.clip(candidate, lower, upper)
                candidate_error = error(candidate)
                if candidate_error < best_error:
                    best_p, best_error = candidate, candidate_error
        scales /= 2.0

    predicted_full = spectral_reflectance(*best_p)
    predicted_samples = np.interp(sample_wavelength, WAVELENGTHS, predicted_full)
    sample_population_sd = np.interp(sample_wavelength, source_wavelength, source_population_sd)
    population_sd_rms = float(np.sqrt(np.mean(np.square(sample_population_sd))))

    def q_minimum(wavelength: np.ndarray, reflectance: np.ndarray, center: float) -> float:
        indices = np.flatnonzero((wavelength >= center - 10.0) & (wavelength <= center + 10.0))
        local = indices[int(np.argmin(reflectance[indices]))]
        if local == 0 or local == len(reflectance) - 1:
            raise ValueError("Q-band search reached a spectrum boundary")
        if not (
            reflectance[local] <= reflectance[local - 1]
            and reflectance[local] <= reflectance[local + 1]
            and (
                reflectance[local] < reflectance[local - 1]
                or reflectance[local] < reflectance[local + 1]
            )
        ):
            raise ValueError(f"No local minimum within 10 nm of {center} nm")
        return float(wavelength[local])

    control_grid = np.interp(WAVELENGTHS, source_wavelength, source_reflectance)
    return {
        "fit": {"Cm": float(best_p[0]), "betaM": float(best_p[1]), "Ch": float(best_p[2])},
        "values": [
            {
                "wavelengthNm": float(wavelength),
                "reflectance": float(value),
                "populationSd": float(sd),
            }
            for wavelength, value, sd in zip(sample_wavelength, measured, sample_population_sd)
        ],
        "rmsReflectanceError": best_error,
        "populationSdRmsTolerance": population_sd_rms,
        "controlQBandMinimaNm": [
            q_minimum(source_wavelength, source_reflectance, 542.0),
            q_minimum(source_wavelength, source_reflectance, 577.0),
        ],
        "modelQBandMinimaNm": [
            q_minimum(WAVELENGTHS, predicted_full, 542.0),
            q_minimum(WAVELENGTHS, predicted_full, 577.0),
        ],
        "controlLab": reflectance_to_lab(control_grid),
        "modelLab": reflectance_to_lab(predicted_full),
        "modelReflectance": predicted_samples.tolist(),
    }


def fit_lab(measured: list[float]) -> tuple[np.ndarray, list[float], float]:
    """Deterministic bounded G3 fit; only the five separate refits use this path."""
    target = np.asarray(measured, dtype=float)
    best_p = None
    best_lab = None
    best_error = math.inf
    for Cm in np.linspace(0.0, 0.5, 26):
        for beta_m in np.linspace(0.0, 1.0, 11):
            for Ch in np.geomspace(0.001, 0.1, 13):
                lab = derive_lab(float(Cm), float(beta_m), float(Ch))
                error = float(np.linalg.norm(np.asarray(lab) - target))
                if error < best_error:
                    best_p, best_lab, best_error = np.asarray([Cm, beta_m, Ch]), lab, error
    scales = np.asarray([0.02, 0.1, 0.3])
    lower = np.asarray([0.0, 0.0, 0.001])
    upper = np.asarray([0.5, 1.0, 0.1])
    for _ in range(8):
        for axis in range(3):
            for offset in np.linspace(-1.0, 1.0, 21):
                candidate = best_p.copy()
                if axis < 2:
                    candidate[axis] += offset * scales[axis]
                else:
                    candidate[axis] *= math.exp(offset * scales[axis])
                candidate = np.clip(candidate, lower, upper)
                lab = derive_lab(*candidate)
                error = float(np.linalg.norm(np.asarray(lab) - target))
                if error < best_error:
                    best_p, best_lab, best_error = candidate, lab, error
        scales /= 2.0
    return best_p, best_lab, best_error


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
        parameters, derived, miss = fit_lab(measured)
        points.append(
            {
                "id": identifier,
                "measuredLab": measured,
                "derivedLab": derived,
                "Cm": float(parameters[0]),
                "betaM": float(parameters[1]),
                "Ch": float(parameters[2]),
                "dE76": miss,
                "onRangeBound": {
                    "Cm": bool(parameters[0] in PARAMETER_RANGES["Cm"]),
                    "betaM": bool(parameters[1] in PARAMETER_RANGES["betaM"]),
                    "Ch": bool(parameters[2] in PARAMETER_RANGES["Ch"]),
                },
            }
        )
    return {"knownGood": points}


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--lab", nargs=3, type=float, metavar=("CM", "BETA_M", "CH"))
    group.add_argument("--spectrum", nargs=3, type=float, metavar=("CM", "BETA_M", "CH"))
    group.add_argument("--calibrate", type=Path, metavar="TONE_REPORT_JSON")
    group.add_argument("--control", action="store_true")
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
    elif args.calibrate is not None:
        print(json.dumps(calibrate(args.calibrate), indent=2))
    else:
        print(json.dumps(fit_control(), indent=2))


if __name__ == "__main__":
    main()
