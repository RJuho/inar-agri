// All parameters of scripts/calc.ts. The script prints this object into
// data/calculated/report.md and into the Parquet metadata.
//
// Sources: Reichstein et al. 2005 (Glob. Change Biol. 11, 1424), the
// REddyProc R package (R/EddyPartitioning.R, R/EddyGapfilling.R),
// Papale et al. 2006 (Biogeosciences 3, 571), Hu et al. 2024
// (Commun. Earth Environ. 5, 38). Design: docs/calculated.md.

export const CONST = {
  /** Lloyd and Taylor 1994: reference temperature (°C) and T0 (°C). */
  lloydTaylor: { tref: 15, t0: -46.02 },

  /** µmol CO2 m-2 s-1 over one 30-minute period = this many g C m-2. Same factor as the website. */
  hhToGc: 1800 * 12.011e-6,

  /** Night: incoming shortwave radiation below this (W m-2), or PPFD below this (µmol m-2 s-1) when sw_in is NULL. */
  night: { swIn: 10, ppfd: 20 },

  /** E0 estimation (REddyProc fRegrE0fromShortTerm). Window = ±winDays, so 15 days. A window needs more than minData values. */
  e0: {
    winDays: 7,
    stepDays: 5,
    minData: 6,
    minTempRange: 5,
    /** Accepted range of E0 ± SD. REddyProc: 30..350 K for air temperature, 30..550 K for soil temperature. */
    limits: { ta: { min: 30, max: 350 }, tsoil: { min: 30, max: 550 } },
    /** Residuals outside this percentile band are dropped before the second fit. */
    trimPercent: 5,
    /** The final E0 is the mean of this many estimates with the smallest SD. */
    nBest: 3,
  },

  /** Rref estimation (REddyProc sRegrRref). Window = ±winDays, so 7 days. A window needs more than minData values. */
  rref: {
    winDays: 3,
    stepDays: 4,
    minData: 2,
    /** reco_fqc = 2 where the nearest Rref window centre is farther than this (days). */
    maxCentreDistanceDays: 14,
  },

  /** Temperature gap fill before Reco: linear interpolation up to maxLinearRows, then mean diurnal course over ±days. */
  taFill: { maxLinearRows: 6, mdcDays: [7, 14, 30], hourTolRows: 2 },

  /** 'keep': GPP = Reco - NEE in every row (REddyProc). 'zero': GPP = 0 and Reco = NEE at night. */
  gppNight: 'keep' as 'keep' | 'zero',

  /** Maktau measured flux filter. */
  maktau: {
    /** Keep rows with FC_SSITC_TEST at or below this. */
    ssitcMax: 1,
    /** Keep rows that have a flux but no flag. */
    keepUnflagged: false,
    /** Plausibility: |FC| below this (µmol m-2 s-1). Hu et al. 2024. */
    plausibility: 50,
    /** Fixed u* threshold (m s-1). Hu et al. 2024. */
    ustarFixed: 0.1,
    /** Papale 2006 moving point test: classes and bounds. */
    mpt: { tempClasses: 6, ustarClasses: 20, plateauFraction: 0.99, lookAhead: 10, maxCorr: 0.4, min: 0.05, max: 0.5 },
  },

  /** MDS gap filling (Reichstein 2005 Fig. A1, REddyProc defaults). */
  mds: { tolSwIn: 50, tolTa: 2.5, tolVpd: 5, minCount: 2 },

  /** Annual sums: a year is 'reliable' when the measured fraction and the longest gap pass these. */
  reliable: { minFracMeasured: 0.2, maxGapDays: 30 },

  /** Heimsch et al. 2024, Agric. Ecosyst. Environ. 374, 109179, Table 1. Years from 4 May. g C m-2 yr-1. NEE positive = emission. NECB positive = loss (opposite of Hu et al.). */
  heimsch2024: [
    { from: '2018-05-04', to: '2019-05-04', nee: 10, gpp: -1154, reco: 1147, input: 93, output: 98, necb: 15 },
    { from: '2019-05-04', to: '2020-05-04', nee: -190, gpp: -1441, reco: 1233, input: 43, output: 173, necb: -60 },
    { from: '2020-05-04', to: '2021-05-04', nee: -80, gpp: -1305, reco: 1207, input: 110, output: 148, necb: -42 },
    { from: '2021-05-04', to: '2022-05-04', nee: -69, gpp: -1180, reco: 1095, input: 2, output: 203, necb: 131 },
    { from: '2022-05-04', to: '2023-05-04', nee: 45, gpp: -1026, reco: 1057, input: 154, output: 55, necb: -54 },
  ],
} as const;

export type TempVariable = 'ta' | 'tsoil';
export type UstarMethod = 'fixed' | 'mpt';

/** Rows per day in a 30-minute series. */
export const ROWS_PER_DAY = 48;
