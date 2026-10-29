// Tables and keys of the Deep Dive "Soil temperature, soil water and soil type as drivers of CH₄ and N₂O"
// (pages/deep-dive/soil-ghg-drivers.mdx). Input: analysis/soil-ghg-drivers/results.json
// (analysis/soil-ghg-drivers/soil-ghg-drivers.py). The figures are matplotlib SVG files of the same
// folder. Valibot checks the parts that the tables use; the schema is not strict.
import * as v from 'valibot';
import { fmtNum, resolveReference, type DiveRefId } from '../deepDive';
import { siteEmoji } from '../../scripts/sites';

const N = v.nullable(v.number());
const Spearman = v.object({ rho: v.number(), p: v.number(), n: v.number() });
const Fit = v.object({
  ok: v.boolean(),
  reason: v.nullable(v.string()),
  q10: v.optional(N),
  q10Lo: v.optional(N),
  q10Hi: v.optional(N),
});
const Response = v.object({ n: v.number(), spearman: Spearman, fit: v.optional(Fit) });
const Coef = v.object({ est: v.number(), lo: v.number(), hi: v.number(), p: v.number() });
const Ols = v.object({
  n: v.number(),
  r2: v.number(),
  coef: v.object({ const: Coef, tsoil: Coef, swc: Coef, tsoilXswc: Coef }),
});
const Gas = v.picklist(['ch4', 'n2o']);
type GasId = v.InferOutput<typeof Gas>;
const BySite = <T extends v.GenericSchema>(s: T) => v.record(v.string(), s);
const ByGas = <T extends v.GenericSchema>(s: T) => v.object({ ch4: v.optional(BySite(s)), n2o: BySite(s) });
const AnnualGas = v.object({ kgHa: v.number(), coverage: v.number(), partial: v.boolean() });
const Lit = v.object({
  key: v.string(),
  text: v.string(),
  value: v.union([v.number(), v.string()]),
  unit: v.string(),
  uncertainty: v.nullable(v.record(v.string(), v.union([v.number(), v.string()]))),
  ref: v.string(),
  page: v.string(),
  tableFigure: v.nullable(v.string()),
});

const Cell = v.object({ t: v.number(), w: v.number(), n: v.number(), mean: v.number() });
const HeatSite = v.object({ nDays: v.number(), nCells: v.number(), nDaysInCells: v.number(), maxCell: Cell });

const DataSchema = v.object({
  method: v.object({ gasSites: v.object({ ch4: v.array(v.string()), n2o: v.array(v.string()) }) }),
  sites: v.record(
    v.string(),
    v.object({ name: v.string(), soilType: v.string(), sensorDepthCm: v.number(), years: v.array(v.number()), fertilisationEvents: v.array(v.string()) }),
  ),
  temperature: ByGas(Response),
  water: ByGas(Response),
  ols: ByGas(Ols),
  annual: v.record(v.string(), v.record(v.string(), v.object({ ch4: v.optional(AnnualGas), n2o: AnnualGas }))),
  literatureCompare: v.record(
    v.string(),
    v.object({ site: v.string(), gas: Gas, year: v.number(), literature: v.number(), literatureLo: v.number(), literatureHi: v.number() }),
  ),
  sensitivity: v.object({
    temperature: v.object({ n2o: BySite(Response) }),
    water: v.object({ n2o: BySite(Response) }),
    ols: v.object({ n2o: BySite(Ols) }),
    shareInWindows: v.record(v.string(), v.record(v.string(), v.object({ shareOfDailySum: v.number(), daysInWindows: v.number() }))),
  }),
  heatMap: v.object({
    tBin: v.number(),
    wBin: v.number(),
    ch4: BySite(HeatSite),
    n2o: BySite(HeatSite),
  }),
  literature: v.array(Lit),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), url: v.nullable(v.string()) }),
  }),
});

export type SoilData = v.InferOutput<typeof DataSchema>;

/** Check the JSON: each gas site has the three analyses, and each site has its sums. */
export function soilData(raw: unknown): SoilData {
  const d = v.parse(DataSchema, raw);
  for (const gas of ['ch4', 'n2o'] as const) {
    for (const site of d.method.gasSites[gas]) {
      if (!d.temperature[gas]?.[site] || !d.water[gas]?.[site] || !d.ols[gas]?.[site]) {
        throw new Error(`soil-ghg-drivers: ${gas} ${site} has no temperature, water or OLS result`);
      }
    }
  }
  for (const site of d.method.gasSites.n2o) {
    if (!d.sensitivity.temperature.n2o[site] || !d.sensitivity.ols.n2o[site] || !d.sensitivity.shareInWindows[site]) {
      throw new Error(`soil-ghg-drivers: ${site} has no N2O sensitivity result`);
    }
  }
  return d;
}

/** Number with 3 significant digits and a true minus sign (the OLS coefficients have very different sizes). */
export function sig(x: number, n = 3): string {
  if (x === 0) return '0';
  const s = Math.abs(x) >= 1e-3 ? Number(x.toPrecision(n)).toString() : x.toExponential(n - 1).replace(/e(-?)(\d+)/, (_, m: string, e: string) => ` × 10${m ? '⁻' : ''}${[...e].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join('')}`);
  return s.replace(/^-/, '−');
}

export const GAS_LABEL: Record<GasId, string> = { ch4: 'CH₄', n2o: 'N₂O' };
export const FLUX_UNIT: Record<GasId, string> = { ch4: 'µmol CH₄ m⁻² s⁻¹', n2o: 'nmol N₂O m⁻² s⁻¹' };

const f2 = (x: number) => fmtNum(x, 2);
const q10Text = (r: v.InferOutput<typeof Response>) => {
  const f = r.fit;
  if (!f) return '–';
  if (!f.ok || f.q10 == null || f.q10Lo == null || f.q10Hi == null) return `no fit (${f.reason ?? 'no reason given'})`;
  return `${f2(f.q10)} (${f2(f.q10Lo)} to ${f2(f.q10Hi)})`;
};

/** Emoji of a site code. */
export const emojiOf = (code: string) => siteEmoji(code);

export interface RelRow {
  id: string;
  emoji: string;
  site: string;
  soil: string;
  gas: string;
  days: string;
  rhoT: string;
  rhoW: string;
  q10: string;
  r2: string;
  nfDays: string;
  nfRhoT: string;
  nfRhoW: string;
  nfQ10: string;
  nfR2: string;
}

/** One row per gas and site: Spearman rho, Q10 and OLS R², all days and without the fertilisation days (N₂O). */
export function relRows(d: SoilData): RelRow[] {
  const out: RelRow[] = [];
  for (const gas of ['ch4', 'n2o'] as const) {
    for (const site of d.method.gasSites[gas]) {
      const t = d.temperature[gas]![site]!;
      const w = d.water[gas]![site]!;
      const o = d.ols[gas]![site]!;
      const s = d.sites[site]!;
      const nt = gas === 'n2o' ? d.sensitivity.temperature.n2o[site] : undefined;
      const nw = gas === 'n2o' ? d.sensitivity.water.n2o[site] : undefined;
      const no = gas === 'n2o' ? d.sensitivity.ols.n2o[site] : undefined;
      out.push({
        id: `rel-${gas}-${site}`,
        emoji: emojiOf(site),
        site: s.name,
        soil: s.soilType,
        gas: GAS_LABEL[gas],
        days: t.n === w.n ? fmtNum(t.n, 0) : `${fmtNum(t.n, 0)} / ${fmtNum(w.n, 0)}`,
        rhoT: f2(t.spearman.rho),
        rhoW: f2(w.spearman.rho),
        q10: q10Text(t),
        r2: f2(o.r2),
        nfDays: nt && nw ? (nt.n === nw.n ? fmtNum(nt.n, 0) : `${fmtNum(nt.n, 0)} / ${fmtNum(nw.n, 0)}`) : '–',
        nfRhoT: nt ? f2(nt.spearman.rho) : '–',
        nfRhoW: nw ? f2(nw.spearman.rho) : '–',
        nfQ10: nt ? q10Text(nt) : '–',
        nfR2: no ? f2(no.r2) : '–',
      });
    }
  }
  return out;
}

export interface OlsRow {
  id: string;
  emoji: string;
  site: string;
  gas: string;
  set: string;
  n: string;
  tsoil: string;
  swc: string;
  inter: string;
  r2: string;
}

const coefText = (c: v.InferOutput<typeof Coef>) => `${sig(c.est)} (${sig(c.lo)} to ${sig(c.hi)})`;

/** OLS coefficients per 1 SD with the 95 % CI (HAC), all days and, for N₂O, without the fertilisation days. */
export function olsRows(d: SoilData): OlsRow[] {
  const out: OlsRow[] = [];
  for (const gas of ['ch4', 'n2o'] as const) {
    for (const site of d.method.gasSites[gas]) {
      const sets: [string, string, v.InferOutput<typeof Ols>][] = [['all', 'all days', d.ols[gas]![site]!]];
      if (gas === 'n2o') sets.push(['nofert', 'without fertilisation days', d.sensitivity.ols.n2o[site]!]);
      for (const [key, label, o] of sets) {
        out.push({
          id: `ols-${gas}-${site}-${key}`,
          emoji: emojiOf(site),
          site: d.sites[site]!.name,
          gas: GAS_LABEL[gas],
          set: label,
          n: fmtNum(o.n, 0),
          tsoil: coefText(o.coef.tsoil),
          swc: coefText(o.coef.swc),
          inter: coefText(o.coef.tsoilXswc),
          r2: f2(o.r2),
        });
      }
    }
  }
  return out;
}

export interface AnnualRow {
  id: string;
  emoji: string;
  site: string;
  soil: string;
  year: number;
  ch4: string;
  ch4Lit: string;
  n2o: string;
  n2oLit: string;
  coverage: string;
  fertShare: string;
  fertDays: string;
}

/** Annual sums per site-year with the Shurpali et al. 2025 values (2022) and the N₂O share on fertilisation days. */
export function annualRows(d: SoilData): AnnualRow[] {
  const lit = (site: string, year: number, gas: GasId) => {
    const r = Object.values(d.literatureCompare).find((x) => x.site === site && x.year === year && x.gas === gas);
    if (!r) return '–';
    const digits = (x: number) => (Number.isInteger(x) ? 0 : 1);
    const dg = Math.max(digits(r.literature), digits(r.literatureLo), digits(r.literatureHi));
    return `${fmtNum(r.literature, dg)} (${fmtNum(r.literatureLo, dg)} to ${fmtNum(r.literatureHi, dg)})`;
  };
  const out: AnnualRow[] = [];
  for (const [site, years] of Object.entries(d.annual)) {
    for (const [y, a] of Object.entries(years)) {
      const year = Number(y);
      const share = d.sensitivity.shareInWindows[site]?.[y];
      const cov = a.n2o.coverage;
      out.push({
        id: `annual-${site}-${y}`,
        emoji: emojiOf(site),
        site: d.sites[site]!.name,
        soil: d.sites[site]!.soilType,
        year,
        ch4: a.ch4 ? fmtNum(a.ch4.kgHa, 1) : '–',
        ch4Lit: lit(site, year, 'ch4'),
        n2o: fmtNum(a.n2o.kgHa, 1),
        n2oLit: lit(site, year, 'n2o'),
        coverage: `${fmtNum(cov * 100, 0)} %${a.n2o.partial ? ' (partial)' : ''}`,
        fertShare: share ? `${fmtNum(share.shareOfDailySum * 100, 0)} %` : '–',
        fertDays: share ? fmtNum(share.daysInWindows, 0) : '–',
      });
    }
  }
  return out;
}

export interface LitRow {
  id: string;
  text: string;
  value: string;
  source: string;
  page: string;
}

const fmtLitValue = (x: number | string) => {
  if (typeof x === 'string') return x;
  const s = String(x);
  return fmtNum(x, s.includes('.') ? s.split('.')[1]!.length : 0);
};

/** The LITERATURE rows of the script: value with unit and uncertainty, short citation, page. */
export function litRows(d: SoilData): LitRow[] {
  return d.literature.map((r) => {
    const u = r.uncertainty;
    let unc = '';
    if (u && 'lo' in u && 'hi' in u) unc = ` (range ${fmtLitValue(u.lo!)} to ${fmtLitValue(u.hi!)})`;
    else if (u && 'sd' in u) unc = ` (SD ${fmtLitValue(u.sd!)})`;
    const unit = r.unit === 'soil type' ? '' : ` ${r.unit}`;
    return {
      id: `lit-${r.key}`,
      text: r.text,
      value: `${fmtLitValue(r.value)}${unit}${unc}`,
      source: resolveReference(r.ref as DiveRefId).short,
      page: r.page + (r.tableFigure ? `, ${r.tableFigure}` : ''),
    };
  });
}

/** Text value of a LITERATURE row (for values that are text, for example a range "30 to 69"). */
export function litText(d: SoilData, key: string): string {
  const r = d.literature.find((x) => x.key === key);
  if (!r) throw new Error(`soil-ghg-drivers: no literature row ${key}`);
  return fmtLitValue(r.value);
}

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
  columns: string;
}

export function inputRows(d: SoilData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

/** The fertilisation dates of a site, as "2022-05-23, 2022-06-22 and …". */
export function fertDates(d: SoilData, site: string): string {
  const e = d.sites[site]?.fertilisationEvents ?? [];
  if (e.length < 2) return e.join('');
  return `${e.slice(0, -1).join(', ')} and ${e[e.length - 1]}`;
}

/** The cell of Figure 3 with the largest mean: "12 to 14 °C and 0.36 to 0.40 m³ m⁻³". */
export function maxCellText(d: SoilData, gas: GasId, site: string): string {
  const c = d.heatMap[gas][site]?.maxCell;
  if (!c) throw new Error(`soil-ghg-drivers: no heat map cell for ${gas} ${site}`);
  return `${fmtNum(c.t, 0)} to ${fmtNum(c.t + d.heatMap.tBin, 0)} °C and ${fmtNum(c.w, 2)} to ${fmtNum(c.w + d.heatMap.wBin, 2)} m³ m⁻³`;
}

/** Share of measured 30-min values in 2022 (Shurpali et al. 2025), from the text value "Anttila 67/67, Sarkisuo 28/30" (CH4/N2O, %). */
export function measuredCoverage(d: SoilData): Record<'anttila' | 'sarkisuo', Record<GasId, number>> {
  const r = d.literature.find((x) => x.key === 'measuredCoverageCh4N2o');
  const m = r && typeof r.value === 'string' ? /Anttila (\d+)\/(\d+), Sarkisuo (\d+)\/(\d+)/.exec(r.value) : null;
  if (!m) throw new Error('soil-ghg-drivers: the literature row measuredCoverageCh4N2o has an unknown form');
  return { anttila: { ch4: Number(m[1]), n2o: Number(m[2]) }, sarkisuo: { ch4: Number(m[3]), n2o: Number(m[4]) } };
}
