// Delta-T ML3 ThetaProbe: conversion of the sensor output voltage to the
// volumetric soil water content. Used for the Qvidja `SM` column, which is the
// raw sensor output in V (confirmed by the data provider, 2026-10-22).
//
// Source: Delta-T Devices Ltd, "User Manual for the ML3 ThetaProbe Soil
// Moisture Sensor", ML3-UM-2.1, January 2017
// (data/manuals/ML3-user-manual-version-2.1.pdf):
// - p. 22, "Soil moisture reading", "Polynomial conversion": the polynomial for
//   a generalised mineral soil (a0 = 1.6, a1 = 8.4, p. 20). Qvidja is clay
//   loam, thus mineral soil (p. 17: "Mineral for sand, silt or clay soils").
// - p. 26, "Specifications": measurement range 0 to 100 % vol. Output 0 to 1 V
//   is about 0 to 60 % vol.
// - p. 23, "Linearisation table": the reference values in ml3.test.ts.
//
// Details and checks: docs/qvidja-soil-moisture.md.

/** Coefficients c0..c6 of θ = Σ ci·V^i (V in volts, θ in m3 m-3), mineral soil, manual p. 22. */
export const ML3_MINERAL_COEFFS = [-0.071, 0.735, 0.75, -8.759, 21.838, -21.998, 8.097] as const;

/** Valid θ range in m3 m-3 (manual p. 26: measurement range 0 to 100 % vol). Values outside become NULL. */
export const ML3_THETA_RANGE: readonly [number, number] = [0, 1];

/** θ (m3 m-3) from the ML3 output V (volts), mineral soil. No range check. */
export function ml3MineralTheta(volts: number): number {
  let r = 0;
  for (let i = ML3_MINERAL_COEFFS.length - 1; i >= 0; i--) r = r * volts + ML3_MINERAL_COEFFS[i]!;
  return r;
}

/** The same polynomial as a SQL expression (Horner form) over the SQL expression `x`. */
export function ml3MineralThetaSql(x: string): string {
  const c = ML3_MINERAL_COEFFS;
  let sql = String(c[c.length - 1]);
  for (let i = c.length - 2; i >= 0; i--) sql = `(${sql}) * ${x} + (${c[i]})`;
  return sql;
}
