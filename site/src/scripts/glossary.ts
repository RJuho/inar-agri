// Short summaries of the variables, with sources from the articles in data/articles/.
// The data page (ui/params.ts) and the Variables page (pages/variables.astro) use this file.
// This file has no DOM code. A unit test (glossary.test.ts) checks the length of each summary.

import type { Variable } from './state';

export const REF_IDS = [
  'heimsch2021',
  'heimsch2024',
  'shurpali2025',
  'vira2025',
  'rasanen2026',
  'ke2025',
  'gao2026',
  'sirola2024',
  'vettikkat2026',
] as const;
export type RefId = (typeof REF_IDS)[number];

export interface Reference {
  /** Author list as printed in the article. */
  authors: string;
  /** Short form for the citation, for example "Heimsch et al. 2021". */
  short: string;
  year: number;
  title: string;
  /** Journal, volume and pages or article number. */
  journal: string;
  doi: string;
  /** File name in data/articles/. */
  file: string;
}

export const REFERENCES: Record<RefId, Reference> = {
  heimsch2021: {
    authors: 'Heimsch, L., Lohila, A., Tuovinen, J.-P., Vekuri, H., Heinonsalo, J., Nevalainen, O., Korkiakoski, M., Liski, J., Laurila, T. and Kulmala, L.',
    short: 'Heimsch et al. 2021',
    year: 2021,
    title: 'Carbon dioxide fluxes and carbon balance of an agricultural grassland in southern Finland',
    journal: 'Biogeosciences 18, 3467–3483',
    doi: '10.5194/bg-18-3467-2021',
    file: 'Heimsch_2021.pdf',
  },
  heimsch2024: {
    authors: 'Heimsch, L., Vira, J., Fer, I., Vekuri, H., Tuovinen, J.-P., Lohila, A., Liski, J. and Kulmala, L.',
    short: 'Heimsch et al. 2024',
    year: 2024,
    title: 'Impact of weather and management practices on greenhouse gas flux dynamics on an agricultural grassland in Southern Finland',
    journal: 'Agriculture, Ecosystems and Environment 374, 109179',
    doi: '10.1016/j.agee.2024.109179',
    file: 'Heimsch_2024.pdf',
  },
  shurpali2025: {
    authors: 'Shurpali, N., Peltola, O., Li, Y., Manninen, P., Semberg, S., Launiainen, S., Louhisuo, A., Rinne, J., Järvinen, M., Virkajärvi, P. and Martikainen, P. J.',
    short: 'Shurpali et al. 2025',
    year: 2025,
    title: 'GHG balance, its seasonality and response to soil type and management of northern agricultural grasslands: Eddy-covariance flux measurements from three adjacent fields in Finland',
    journal: 'Agriculture, Ecosystems and Environment 393, 109841',
    doi: '10.1016/j.agee.2025.109841',
    file: 'Shurpali_2025.pdf',
  },
  vira2025: {
    authors: 'Vira, J., Vekuri, H., Nevalainen, O., Korkiakoski, M., Mattila, T., Aaltonen, H., Koskinen, M., Lohila, A., Pihlatie, M. and Liski, J.',
    short: 'Vira et al. 2025',
    year: 2025,
    title: 'Improving agricultural carbon monitoring with Sentinel-2 and eddy-covariance-based plant productivity estimates',
    journal: 'Carbon Management 16(1), 2568042',
    doi: '10.1080/17583004.2025.2568042',
    file: 'Vira_2025_C-Sentinel-2_EC.pdf',
  },
  rasanen2026: {
    authors: 'Räsänen, M., Omondi, J., Odongo, V., Abera, T., Tuure, J., Heiskanen, J., Hsieh, C.-I., Alakukku, L., Merbold, L., Pellikka, P. and Vesala, T.',
    short: 'Räsänen et al. 2026',
    year: 2026,
    title: 'Critical soil moisture thresholds for evapotranspiration in rainfed semi-arid maize in Kenya',
    journal: 'Agricultural and Forest Meteorology 385, 111219',
    doi: '10.1016/j.agrformet.2026.111219',
    file: 'Räsänen_2026_kenia.pdf',
  },
  ke2025: {
    authors: 'Ke, P., Lintunen, A., Kolari, P., Lohila, A., Tuovinen, S., Lampilahti, J., Thakur, R., Peltola, M., Peräkylä, O., Nieminen, T., Ezhova, E., Pihlatie, M., Laasonen, A., Koskinen, M., Rautakoski, H., Heimsch, L., Kokkonen, T., Vähä, A., Mammarella, I., Noe, S., Bäck, J., Kerminen, V.-M. and Kulmala, M.',
    short: 'Ke et al. 2025',
    year: 2025,
    title: 'Potential of carbon uptake and local aerosol production in boreal and hemi-boreal ecosystems across Finland and in Estonia',
    journal: 'Biogeosciences 22, 3235–3251',
    doi: '10.5194/bg-22-3235-2025',
    file: 'Ke_2025_NEE-aerosol_agri-forest-bg-22-3235-2025.pdf',
  },
  gao2026: {
    authors: 'Gao, Y., Hu, T., Roitto, M., Jokiniemi, T., Sandell, M., Korkiakoski, M., Vekuri, H., Pihlatie, M. and Tuomisto, H. L.',
    short: 'Gao et al. 2026',
    year: 2026,
    title: 'Improving the carbon footprint assessment of milk production: a case study integrating soil carbon stock changes with eddy covariance and DeNitrification-DeComposition model',
    journal: 'The International Journal of Life Cycle Assessment 31, 4',
    doi: '10.1007/s11367-026-02579-3',
    file: 'Gao_2026_Cfootprint_milk-DNDC.pdf',
  },
  sirola2024: {
    authors: 'Sirola, M., Koskinen, M., Polvinen, T. and Pihlatie, M.',
    short: 'Sirola et al. 2024',
    year: 2024,
    title: 'Tracing State Structure for Ecological Processes in Soil Including Greenhouse Gas Exchange with Lower Atmosphere',
    journal: 'Sensors 24, 3507',
    doi: '10.3390/s24113507',
    file: 'Sirola_2024_SMEAR-Agri_PCA_state_ecological_measurements.pdf',
  },
  vettikkat2026: {
    authors: 'Vettikkat, L., Nissinen, A., Miettinen, P., Jokiniemi, T., Polvinen, T., Koskinen, M., Sirola, M., Pihlatie, M., Virtanen, A. and Schobesberger, S.',
    short: 'Vettikkat et al. 2026',
    year: 2026,
    title: 'Field-scale ammonia flux measurements at an agricultural field in southern Finland by mass spectrometry and eddy covariance',
    journal: 'Agricultural and Forest Meteorology 383, 111121',
    doi: '10.1016/j.agrformet.2026.111121',
    file: 'Vettikkat_2026_NH3-flux_SMEAR-Agri_mass-spec_EC.pdf',
  },
};

/** Articles that define one or more of the variables. The others are in the collection, but not cited. */
export const CITED_REFS: readonly RefId[] = ['heimsch2021', 'heimsch2024', 'shurpali2025', 'vira2025', 'rasanen2026', 'ke2025', 'vettikkat2026'];

/** Limits of the summary length in characters (code points). */
export const SUMMARY_MIN = 200;
export const SUMMARY_MAX = 300;

export interface GlossaryEntry {
  /** Full name with the abbreviation. */
  term: string;
  /** 200 to 300 characters. Plain text. */
  summary: string;
  /** Articles that explain the term. Empty = no article explains it. */
  sources: readonly RefId[];
}

export const GLOSSARY: Record<Variable, GlossaryEntry> = {
  nee: {
    term: 'Net ecosystem exchange (NEE), measured',
    summary:
      'The net CO₂ flux between the field and the air, measured by eddy covariance in 30-min periods. NEE = Reco − GPP. A negative NEE is uptake by the field, a positive NEE is release. Only the periods that pass the quality checks have a value.',
    sources: ['heimsch2021', 'shurpali2025', 'ke2025'],
  },
  nee_f: {
    term: 'NEE, gap-filled',
    summary:
      'NEE with the gaps filled. Eddy covariance loses many periods: low turbulence, rain and sensor faults. A model (XGBoost, MDS or a neural network) fills the gaps from weather and soil data. Use this value for daily, monthly and annual sums.',
    sources: ['heimsch2024', 'shurpali2025', 'rasanen2026', 'vira2025'],
  },
  gpp: {
    term: 'Gross primary production (GPP), calculated',
    summary:
      'The CO₂ uptake by plant photosynthesis. We calculate it from the gap-filled NEE with night-time partitioning: GPP = Reco − NEE. Here GPP is zero or positive. Some articles give GPP as a negative value (NEE = GPP + Reco).',
    sources: ['heimsch2021', 'shurpali2025', 'vira2025'],
  },
  reco: {
    term: 'Ecosystem respiration (Reco), calculated',
    summary:
      'The CO₂ release by plants and soil organisms, also ER or TER. We fit the Lloyd–Taylor temperature model to night-time NEE, when GPP is zero. Then the model gives Reco for all hours of the day. Reco is always positive.',
    sources: ['heimsch2021', 'shurpali2025', 'vira2025'],
  },
  gpp_src: {
    term: 'GPP from the data provider',
    summary:
      'Gross primary production (GPP) as the data provider partitioned it: CO₂ uptake by photosynthesis. Only Anttila, Särkisuo and Qvidja have it. The method can differ from our calculation. Compare it with "GPP, calculated" to see the effect.',
    sources: ['heimsch2021'],
  },
  reco_src: {
    term: 'Reco from the data provider',
    summary:
      'Ecosystem respiration (Reco) as the data provider partitioned it: CO₂ release by plants and soil organisms. Only Anttila, Särkisuo and Qvidja have it. The method can differ from our calculation. Compare it with "Reco, calculated".',
    sources: ['heimsch2021'],
  },
  ch4: {
    term: 'Methane flux (CH₄)',
    summary:
      'The net methane flux between the field and the air. A positive value is emission. Wet soil without oxygen can emit CH₄, and dry mineral soil can take up a small quantity. Eddy covariance measures it at Anttila and Särkisuo only.',
    sources: ['shurpali2025', 'heimsch2024'],
  },
  n2o: {
    term: 'Nitrous oxide flux (N₂O)',
    summary:
      'The net N₂O flux between the field and the air, in nmol N₂O m⁻² s⁻¹. A positive value is emission. N₂O is a strong greenhouse gas (GWP 273). Emission peaks come after fertilisation and after rain on wet soil. For the Viikki data, we assume the unit µg N₂O m⁻² s⁻¹.',
    sources: ['shurpali2025', 'heimsch2024'],
  },
  le: {
    term: 'Latent heat flux (LE)',
    summary:
      'The energy that evapotranspiration takes from the field, in W m⁻². Eddy covariance measures it from the water vapour flux. A positive LE is upward. Evapotranspiration in mm = LE × time / 2.45 MJ kg⁻¹. When the soil is dry, LE decreases and more energy goes to sensible heat.',
    sources: ['rasanen2026', 'heimsch2021', 'heimsch2024'],
  },
  ta: {
    term: 'Air temperature (Ta, Tair)',
    summary:
      'The temperature of the air near the eddy covariance tower, at approximately 1.5 to 2 m above the ground. It controls respiration and plant growth. Gap filling of NEE and the respiration model of the partitioning use it as an input.',
    sources: ['heimsch2021', 'shurpali2025', 'rasanen2026'],
  },
  sw_in: {
    term: 'Incoming shortwave radiation (SW_in)',
    summary:
      'The solar radiation that reaches the ground, in W m⁻². Other names are global radiation and SWd. Approximately half of it is photosynthetically active radiation (PAR). We use SW_in below 10 W m⁻² to find night-time periods.',
    sources: ['rasanen2026', 'vira2025'],
  },
  ppfd: {
    term: 'Photosynthetic photon flux density (PPFD)',
    summary:
      'The light in the 400 to 700 nm band that plants use for photosynthesis, in µmol m⁻² s⁻¹. Articles also call it PAR. PPFD controls GPP. The partitioning uses PPFD below 20 µmol m⁻² s⁻¹ to find night-time periods.',
    sources: ['shurpali2025', 'ke2025', 'heimsch2021', 'vira2025'],
  },
  rh: {
    term: 'Relative humidity (RH)',
    summary:
      'The water vapour in the air as a percentage of the maximum that the air can hold at the same temperature. 100 % is saturated air. With air temperature, RH gives the vapour pressure deficit (VPD). RH is an input to some gap-filling models.',
    sources: ['rasanen2026', 'heimsch2024'],
  },
  vpd: {
    term: 'Vapour pressure deficit (VPD)',
    summary:
      'The difference between the maximum water vapour pressure and the actual vapour pressure of the air. We calculate it from RH and air temperature. When VPD is high, plants close their stomata. This decreases photosynthesis and evaporation.',
    sources: ['heimsch2024', 'rasanen2026', 'shurpali2025'],
  },
  ustar: {
    term: 'Friction velocity (u*, ustar)',
    summary:
      'A measure of the turbulence of the air near the ground, in m s⁻¹. When u* is below a threshold of the site, eddy covariance gives a flux that is too low. Thus we remove these periods from NEE, and then gap filling fills them.',
    sources: ['heimsch2024', 'shurpali2025', 'vira2025', 'rasanen2026'],
  },
  precip: {
    term: 'Precipitation (P)',
    summary:
      'The water from rain and snow that falls on the field, in mm per 30 min. A daily, weekly or monthly step gives the sum, not the mean. Rain gauges catch too little snow. At Viikki, P is rain plus snow. Rain after a dry period can increase respiration and N₂O emission.',
    sources: ['heimsch2021', 'heimsch2024', 'shurpali2025', 'rasanen2026'],
  },
  pa: {
    term: 'Air pressure (PA)',
    summary:
      'The pressure of the air at the tower, in kPa. Near sea level it is approximately 100 kPa. At Maktau, which is at a higher elevation, it is approximately 90 kPa. The eddy covariance software uses PA to calculate the air density and the gas fluxes.',
    sources: ['rasanen2026', 'heimsch2024'],
  },
  ws: {
    term: 'Wind speed (WS)',
    summary:
      'The horizontal speed of the wind at the tower, in m s⁻¹. The sonic anemometer of the eddy covariance system measures it. With u*, wind speed shows the turbulence. Low wind at night often gives low turbulence and gaps in NEE. Strong wind dries the soil and the plants.',
    sources: ['rasanen2026', 'heimsch2024', 'ke2025', 'vettikkat2026'],
  },
  wd: {
    term: 'Wind direction (WD)',
    summary:
      'The direction from which the wind comes, in degrees from north: 0 = north, 90 = east, 180 = south. A daily value is a circular mean, thus 350° and 10° give 0°. Sector filtering removes the periods when the wind comes from outside the field, for example from a road or a building.',
    sources: ['heimsch2021', 'heimsch2024', 'shurpali2025', 'ke2025', 'rasanen2026'],
  },
  netrad: {
    term: 'Net radiation (Rn)',
    summary:
      'The net radiation energy at the surface, in W m⁻²: Rn = SW_in − SW_out + LW_in − LW_out. A positive value is energy into the surface. Rn gives the energy for the latent heat flux (LE), the sensible heat flux and the soil heat flux (G). At night Rn is usually negative.',
    sources: ['rasanen2026', 'heimsch2021', 'shurpali2025'],
  },
  sw_out: {
    term: 'Outgoing shortwave radiation (SW_out)',
    summary:
      'The solar radiation that the surface reflects up, in W m⁻². The albedo is SW_out / SW_in. A green crop reflects approximately 20 %, bare soil less and fresh snow up to 90 %. Thus SW_out shows the snow cover, the growth of the crop and the harvest.',
    sources: ['rasanen2026', 'heimsch2021', 'heimsch2024'],
  },
  tsoil: {
    term: 'Soil temperature (Ts, Tsoil)',
    summary:
      'The temperature of the soil at the shallowest sensor, at a depth of 5 to 14 cm. It controls the respiration of roots and soil microbes, thus it changes Reco and CH₄ flux. Gap filling of NEE uses soil temperature as an input.',
    sources: ['shurpali2025', 'heimsch2021', 'heimsch2024'],
  },
  swc: {
    term: 'Soil water content (SWC)',
    summary:
      'The volume of water per volume of soil, in m³ m⁻³, at the shallowest sensor. Other names are soil moisture and SMC. Dry soil stops plant growth and wet soil decreases oxygen. Both change respiration and the CH₄ flux.',
    sources: ['heimsch2024', 'shurpali2025', 'rasanen2026'],
  },
  g: {
    term: 'Soil heat flux (G)',
    summary:
      'The flow of heat into or out of the soil, in W m⁻². Heat flux plates a few cm below the surface measure it. A positive G is heat into the soil. G is usually a small part of Rn. It is positive in the day and in spring, and negative at night and in autumn.',
    sources: ['rasanen2026', 'heimsch2021'],
  },
};

/** Length in characters (code points, thus "CO₂" is 3). */
export function charCount(text: string): number {
  return [...text].length;
}

/** Short citation, for example "(Heimsch et al. 2021; Shurpali et al. 2025)". Empty when there is no source. */
export function citeShort(sources: readonly RefId[]): string {
  return sources.length === 0 ? '' : `(${sources.map((id) => REFERENCES[id].short).join('; ')})`;
}
