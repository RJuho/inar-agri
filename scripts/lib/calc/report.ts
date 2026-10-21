// Markdown rendering of the calc report. The tables with data come from
// DuckDB queries (rows of plain objects); the fit diagnostics from the
// report object.

import { fmt, table } from '../duck.ts';
import type { Report } from './schemas.ts';

type Row = Record<string, unknown>;

/** Markdown table of query rows: the columns in the order given, numbers formatted. */
export function rowsTable(rowsIn: Row[], columns: string[]): string {
  return table(
    columns,
    rowsIn.map((r) => columns.map((c) => cell(r[c]))),
  );
}

function cell(x: unknown): string | number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return fmt(x);
  if (typeof x === 'boolean') return x ? 'yes' : 'no';
  return String(x);
}

export type ReportTables = {
  annual: Row[];
  necb: Row[];
  validationPartition: Row[];
  validationQvidja: Row[];
  validationHaltiala: Row[];
  management: Row[];
};

export function renderMarkdown(report: Report, t: ReportTables): string {
  const p: string[] = [];
  p.push('# Calculation report: derived flux products');
  p.push('');
  p.push(`Built ${report.builtAt} with DuckDB ${report.duckdb} and Node ${report.node}. Generator: scripts/calc.ts. Design: docs/calculated.md.`);
  p.push('');
  p.push(`Options: ${JSON.stringify(report.options)}`);
  p.push('');
  p.push('## Output files');
  p.push('');
  p.push(table(['File', 'Rows', 'Bytes'], report.outputs.map((o) => [o.file, o.rows, o.bytes])));
  p.push('');
  p.push('## Night-time partitioning per site and year');
  p.push('');
  p.push('E0 in K with its standard error. Method: windows = mean of the 3 best 15-day windows, few_windows = fewer than 3 valid windows, annual = one fit on all nights, none = no E0. Rref in µmol m-2 s-1 at 15 °C. Rows with reco_fqc 2 are farther than 14 days from a Rref window.');
  p.push('');
  p.push(
    table(
      ['Site', 'Year', 'Night values', 'E0', 'SE', 'Method', 'E0 windows valid / tried', 'Rref windows', 'Rref min', 'Rref max', 'Rows with Reco', 'Rows fqc 2', 'Temp. rows filled'],
      report.partition.map((r) => [
        r.site, r.year, r.nNight, fmt(r.e0), fmt(r.e0Se), r.e0Method, `${r.e0WindowsValid} / ${r.e0WindowsTried}`, r.rrefWindowsUsed, fmt(r.rrefMin), fmt(r.rrefMax), r.rowsReco, r.rowsFqc2, r.tempFilled,
      ]),
    ),
  );
  if (report.maktau) {
    const m = report.maktau;
    p.push('');
    p.push('## Maktau: quality filter, u* and gap filling');
    p.push('');
    p.push(`u* threshold applied: ${fmt(m.ustarThreshold)} m s-1. Measured flux rows between ${m.fillRange.from} and ${m.fillRange.to} (UTC) were gap-filled.`);
    p.push('');
    p.push(table(['Filter step', 'Rows'], Object.entries(m.filter).map(([k, n]) => [k, n])));
    p.push('');
    p.push('Moving point test (Papale et al. 2006) per year, reported only unless the option --ustar mpt is set:');
    p.push('');
    p.push(table(['Year', 'Threshold', 'Bounded', 'Seasons (night values: threshold)'], m.mpt.map((y) => [y.year, fmt(y.threshold), fmt(y.bounded), y.seasons.map((s) => `${s.season} (${s.nNight}: ${fmt(s.threshold)})`).join(', ')])));
    p.push('');
    p.push(table(['MDS result', 'Rows'], Object.entries(m.mds).map(([k, n]) => [k, n])));
  }
  p.push('');
  p.push('## Annual sums (g C m-2, local calendar year)');
  p.push('');
  p.push('Sums use the gap-filled NEE and the partitioned GPP and Reco. A sum is NULL when a row of the year has no value. reliable = measured fraction at least 0.2 and longest gap at most 30 days. sd10 and ci95 are the Haltiala uncertainty from the ten gap-filling models.');
  p.push('');
  p.push(rowsTable(t.annual, ['site_code', 'year', 'n_rows', 'frac_measured', 'longest_gap_days', 'reliable', 'nee_f_gc', 'gpp_gc', 'reco_gc', 'gpp_src_gc', 'reco_src_gc', 'nee_f_sd10', 'nee_f_ci95']));
  p.push('');
  p.push('## Net ecosystem carbon balance (g C m-2 yr-1)');
  p.push('');
  p.push('NECB = -NEE - C_harvest + C_exo - C_CH4 (Hu et al. 2024 Eq. 1 reduced; positive = the ecosystem gains carbon). n_exo_unknown counts organic inputs without a carbon content; n_assumed counts rows with an assumed carbon fraction or unit.');
  p.push('');
  p.push(rowsTable(t.necb, ['site_code', 'year', 'nee_f_gc', 'c_harvest', 'c_exo', 'c_ch4', 'necb', 'necb_complete', 'n_exo_unknown', 'n_assumed', 'note']));
  p.push('');
  p.push('## Validation');
  p.push('');
  p.push('### Calculated partitioning against the data providers');
  p.push('');
  p.push('Annual sums in g C m-2. RMSE and bias in µmol m-2 s-1 over the rows where both exist. E0 of the provider from the flux files (one value per year).');
  p.push('');
  p.push(rowsTable(t.validationPartition, ['site_code', 'year', 'gpp_gc', 'gpp_src_gc', 'gpp_diff_pct', 'reco_gc', 'reco_src_gc', 'reco_diff_pct', 'rmse_reco', 'bias_reco', 'rmse_gpp', 'e0', 'e0_src', 'corr_rref']));
  p.push('');
  p.push('### Qvidja against Heimsch et al. 2024, Table 1 (years from 4 May, g C m-2)');
  p.push('');
  p.push('The paper gives NEE positive = emission and NECB positive = loss. Here NECB has the sign of Hu et al. (positive = gain), so necb_paper is the paper value with the sign changed. The source file is a later processing version than the paper.');
  p.push('');
  p.push(rowsTable(t.validationQvidja, ['period', 'nee_f_gc', 'nee_paper', 'gpp_gc', 'gpp_src_gc', 'gpp_paper', 'reco_gc', 'reco_src_gc', 'reco_paper', 'necb', 'necb_paper', 'class']));
  p.push('');
  p.push('### Haltiala annual NEE against the ten gap-filling models');
  p.push('');
  p.push(rowsTable(t.validationHaltiala, ['year', 'nee_f_gc', 'mean10', 'diff', 'sd10', 'ci95']));
  p.push('');
  p.push('## Management carbon table');
  p.push('');
  p.push(rowsTable(t.management, ['site', 'date', 'action', 'product', 'dry_mass_kg_ha', 'c_fraction', 'c_fraction_source', 'c_g_m2', 'note']));
  p.push('');
  p.push('## Warnings');
  p.push('');
  p.push(report.warnings.length ? report.warnings.map((w) => `- ${w}`).join('\n') : 'None.');
  p.push('');
  p.push('## Constants');
  p.push('');
  p.push('```json');
  p.push(JSON.stringify(report.constants, null, 2));
  p.push('```');
  p.push('');
  return p.join('\n');
}
