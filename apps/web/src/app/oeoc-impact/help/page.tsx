import type { Metadata } from "next";
import {
  EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR,
  EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR,
  EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR,
  ENERGY_BUILDING_ADJACENCY_SHARE,
  formatNumber,
  gramsToPounds,
  ITREE_AIR_POLLUTANT_BREAKDOWN,
  ITREE_AVOIDED_RUNOFF_USD_PER_GALLON,
  ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND,
  MATURE_CANOPY_SQ_FT_PER_TREE,
  metricTonsToPounds,
  ROAD_PAVEMENT_SHADE_SHARE,
  ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR,
  TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR,
  USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS
} from "@/lib/impactCalculations";

export const metadata: Metadata = {
  title: "OEOC Dashboard Help",
  description: "Usage, export instructions, calculation rules, assumptions, and source citations for the OEOC Environmental Impact dashboard."
};

const CO2_REMOVED_LBS_PER_TREE_YEAR =
  metricTonsToPounds(EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR) ?? 0;
const AIR_POLLUTANTS_LBS_PER_TREE_YEAR =
  gramsToPounds(EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR) ?? 0;
const ROAD_RESURFACING_RATE_LABEL = `$${ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR.toFixed(4)}`;
const AIR_POLLUTANT_VALUE_RATE_LABEL = `$${ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND.toFixed(2)}`;
const STORMWATER_RATE_LABEL = `$${ITREE_AVOIDED_RUNOFF_USD_PER_GALLON.toFixed(4)}`;
const ENERGY_EFFECTIVE_RATE_LABEL = `$${(
  TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR * ENERGY_BUILDING_ADJACENCY_SHARE
).toFixed(2)}`;

const sourceLinks = [
  {
    href: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",
    label: "EPA Greenhouse Gas Equivalencies Calculator - calculations and references",
    note: "Used for the urban tree CO2 removal rate."
  },
  {
    href: "https://www.epa.gov/heatislands/benefits-trees-and-vegetation",
    label: "EPA Benefits of Trees and Vegetation",
    note: "Used as EPA context for tree cooling, stormwater, air quality, and energy benefits."
  },
  {
    href: "https://www.epa.gov/benmap",
    label: "EPA BenMAP-CE",
    note: "Used as the EPA source for air pollution health and economic value methodology referenced by i-Tree."
  },
  {
    href: "https://www.epa.gov/benmap/how-benmap-ce-estimates-health-and-economic-effects-air-pollution",
    label: "EPA BenMAP-CE health and economic effects method",
    note: "Explains how EPA estimates health and dollar values for air quality changes."
  },
  {
    href: "https://canopy.itreetools.org/benefits",
    label: "i-Tree Canopy benefits configuration",
    note: "Used for tree canopy benefit categories and units."
  },
  {
    href: "https://landscape.itreetools.org/references/data/",
    label: "i-Tree Landscape data references",
    note: "Used for carbon, air pollution, and hydrology methodology notes."
  },
  {
    href: "https://dev.itreetools.org/support/resources-overview/i-tree-methods-and-files",
    label: "i-Tree methods and technical files",
    note: "Used as the technical-methods index for i-Tree Canopy and i-Tree Eco."
  },
  {
    href: "https://research.fs.usda.gov/treesearch/46009",
    label: "USFS street tree shade and pavement performance study",
    note: "Used for the road resurfacing planning estimate."
  },
  {
    href: "https://research.fs.usda.gov/treesearch/60565",
    label: "USFS tree shade impacts on residential energy use study",
    note: "Used for the energy savings planning estimate."
  }
];

function percent(value: number) {
  return `${formatNumber(value * 100, 1)}%`;
}

function fullCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: "currency"
  }).format(value);
}

export default function OEOCImpactHelpPage() {
  return (
    <main className="shell appShell impactShell helpShell">
      <header className="topBar appTopBar">
        <div>
          <p className="kicker">One Earth One Chance</p>
          <h1>OEOC Dashboard Help</h1>
        </div>
        <nav className="appNav" aria-label="Help navigation">
          <a href="/oeoc-impact">Back to dashboard</a>
        </nav>
      </header>

      <section className="helpIntro">
        <p className="kicker">Plain-language guide</p>
        <h2>What this application does</h2>
        <p>
          The OEOC Environmental Impact dashboard turns the Tree Map sheet into a map,
          yearly impact charts, and export files. It shows where planting work happened,
          how many plantings and square feet of tree canopy were recorded, and estimated
          environmental benefits over time.
        </p>
        <p>
          The dashboard is an impact-estimation tool. It is not an EPA compliance report,
          engineering design, tax report, or audited carbon credit calculation.
        </p>
      </section>

      <section className="helpGrid" aria-label="Help sections">
        <article className="helpSection">
          <h2>How to Use the Dashboard</h2>
          <ol>
            <li>
              Start with the map. The home button returns the map to the Dallas-Fort Worth
              area containing the OEOC work locations.
            </li>
            <li>
              Click a marker to see the planting location, event, category, partners,
              plantings, canopy, and estimated impact values for that location.
            </li>
            <li>
              Use the map zoom controls to inspect a tighter area. The marker sizes show
              relative planting volume, and the marker colors match the dashboard legend.
            </li>
            <li>
              Drag the map resize handle when you need more vertical map space.
            </li>
            <li>
              Read the yearly charts below the map. Each year includes the impact from
              plantings made that year and plantings from earlier years that are still
              contributing through the selected estimate date.
            </li>
            <li>
              Use the small information icon on a graph to review that graph's formula and
              source notes.
            </li>
          </ol>
        </article>

        <article className="helpSection">
          <h2>Data Source and Refresh Logic</h2>
          <p>
            The application reads the OEOC Tree Map Google Sheet as CSV when the sheet is
            reachable. If the live CSV cannot be loaded, the app falls back to the last
            saved snapshot bundled with the site so the dashboard still opens.
          </p>
          <ul>
            <li>Each sheet row becomes one or more mapped work-location records.</li>
            <li>Known parks, schools, and cities are matched to saved coordinates.</li>
            <li>
              If a row can only be placed at city level, the location is marked as
              approximate.
            </li>
            <li>
              The estimate date is the current date in the America/Chicago time zone unless
              an export URL provides a specific estimate date.
            </li>
          </ul>
        </article>

        <article className="helpSection">
          <h2>Export Options</h2>
          <div className="helpCallout">
            <strong>There are two exports.</strong>
            <span>The raw all-data Excel export has been removed.</span>
          </div>
          <h3>Planting Excel Export</h3>
          <p>
            The map-pin export creates an Excel-readable file grouped into yearly sections.
            Within each year, rows are grouped by city and planting location.
          </p>
          <p>
            Use it when you need location-level details: city, planting location, event
            names, dates, partners, plantings, canopy, environmental metrics, cost savings,
            volunteer hours, expense, latitude, longitude, and whether the coordinate is
            approximate.
          </p>
          <h3>Event PDF Export</h3>
          <p>
            The PDF Event dropdown only controls the PDF export. Choose an event, then click
            the document icon to create a styled one-event impact report.
          </p>
          <p>
            Use it when you need a shareable event summary with event totals and planting
            locations for that selected event.
          </p>
        </article>

        <article className="helpSection">
          <h2>Calculation Order</h2>
          <ol>
            <li>
              Read the sheet values for planting date, category, location, plantings, tree
              canopy, runoff, air pollutants, volunteer hours, expense, and partners.
            </li>
            <li>
              Calculate planting equivalent. If plantings are present, use them. If
              plantings are missing but canopy is present, divide canopy by{" "}
              {formatNumber(MATURE_CANOPY_SQ_FT_PER_TREE, 0)} square feet per tree.
            </li>
            <li>
              Calculate age in months from the planting date to the estimate date.
            </li>
            <li>
              Use sheet-provided annual impact values when the sheet provides them. When a
              sheet value is missing, use the fallback estimates below.
            </li>
            <li>
              Prorate annual values by months active divided by 12.
            </li>
            <li>
              Add values across all active plantings. Earlier plantings continue
              contributing in later years.
            </li>
          </ol>
        </article>
      </section>

      <section className="helpSection helpWideSection">
        <h2>Metrics and Formulas</h2>
        <div className="helpTableWrap">
          <table className="helpTable">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Formula Used</th>
                <th>Units</th>
                <th>Important Assumption</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Planting equivalent</td>
                <td>
                  Plantings if listed; otherwise tree canopy sq ft /{" "}
                  {formatNumber(MATURE_CANOPY_SQ_FT_PER_TREE, 0)}
                </td>
                <td>trees</td>
                <td>
                  {formatNumber(MATURE_CANOPY_SQ_FT_PER_TREE, 0)} sq ft is a planning
                  canopy-to-tree conversion, not a field-measured species value.
                </td>
              </tr>
              <tr>
                <td>CO2 Removed</td>
                <td>
                  Planting equivalent x {EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR} metric
                  tons CO2 per tree-year x {formatNumber(2204.62262185, 1)} lbs per metric
                  ton x months active / 12
                </td>
                <td>lbs</td>
                <td>
                  Equals about {formatNumber(CO2_REMOVED_LBS_PER_TREE_YEAR, 1)} lbs CO2
                  removed per urban tree per year.
                </td>
              </tr>
              <tr>
                <td>Runoff Avoided</td>
                <td>
                  Sheet annual runoff if listed; otherwise planting equivalent x{" "}
                  {formatNumber(EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR, 2)} gallons
                  per tree-year x months active / 12
                </td>
                <td>gallons</td>
                <td>
                  Uses a broad i-Tree style annual fallback when local modeled runoff is not
                  provided in the sheet.
                </td>
              </tr>
              <tr>
                <td>Air Pollutants Removed</td>
                <td>
                  Sheet annual pollutant value if listed; otherwise planting equivalent x{" "}
                  {formatNumber(EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR, 3)} grams per
                  tree-year x months active / 12, then grams / 453.59237
                </td>
                <td>lbs</td>
                <td>
                  CO2 is not included here. This avoids double counting with the separate
                  CO2 Removed metric.
                </td>
              </tr>
              <tr>
                <td>Storm Water Management $</td>
                <td>Runoff avoided gallons x {STORMWATER_RATE_LABEL} per gallon</td>
                <td>USD</td>
                <td>Planning dollar value based on the configured i-Tree avoided-runoff rate.</td>
              </tr>
              <tr>
                <td>Air Pollutant Removal $</td>
                <td>Air pollutants removed lbs x {AIR_POLLUTANT_VALUE_RATE_LABEL} per lb</td>
                <td>USD</td>
                <td>
                  Planning value for criteria air pollutants only; it excludes CO2 value.
                </td>
              </tr>
              <tr>
                <td>Road Resurfacing $</td>
                <td>
                  Canopy equivalent sq ft x {ROAD_RESURFACING_RATE_LABEL} per year x months
                  active / 12
                </td>
                <td>USD</td>
                <td>
                  Modeled from {fullCurrency(USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS)}{" "}
                  per sq ft over 30 years and a {percent(ROAD_PAVEMENT_SHADE_SHARE)} assumed
                  pavement-shade share.
                </td>
              </tr>
              <tr>
                <td>Energy Saving $</td>
                <td>
                  Planting equivalent x {fullCurrency(TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR)}{" "}
                  per tree-year x {percent(ENERGY_BUILDING_ADJACENCY_SHARE)} building-adjacent
                  share x months active / 12
                </td>
                <td>USD</td>
                <td>
                  Effective dashboard rate is {ENERGY_EFFECTIVE_RATE_LABEL} per planting
                  equivalent per year.
                </td>
              </tr>
              <tr>
                <td>Total Cost Savings $</td>
                <td>
                  Storm Water Management $ + Air Pollutant Removal $ + Road Resurfacing $ +
                  Energy Saving $
                </td>
                <td>USD</td>
                <td>Does not include a dollar value for CO2 removed.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="helpGrid" aria-label="Assumptions and pollutant details">
        <article className="helpSection">
          <h2>Air Pollutant Split</h2>
          <p>
            The air pollutants graph splits the total criteria pollutant removal into the
            following approximate shares. These percentages are based on the removal-rate
            proportions configured in the application.
          </p>
          <dl className="helpDefinitionList">
            {ITREE_AIR_POLLUTANT_BREAKDOWN.map((pollutant) => (
              <div key={pollutant.label}>
                <dt>
                  <span style={{ backgroundColor: pollutant.color }} />
                  {pollutant.label}
                </dt>
                <dd>
                  {pollutant.description}: {percent(pollutant.share)}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            CO2 is intentionally excluded from this list. It appears only in the CO2 Removed
            metric.
          </p>
        </article>

        <article className="helpSection">
          <h2>Major Assumptions</h2>
          <ul>
            <li>
              Benefits accumulate over time. A tree planted in a prior year continues to add
              CO2, runoff, air pollutant, and cost benefits in later years.
            </li>
            <li>
              The current year is prorated through the estimate date rather than assuming a
              full year has already occurred.
            </li>
            <li>
              The dashboard uses broad EPA/i-Tree/USFS estimate factors, not a species-by-
              species tree inventory.
            </li>
            <li>
              The road and energy cost estimates are planning estimates. They do not know
              exact pavement overlap, building distance, building orientation, local utility
              rates, tree species, or survival.
            </li>
            <li>
              If a sheet value is blank, the app may estimate from planting equivalent. If
              both planting count and canopy are missing, the related impact cannot be
              estimated for that row.
            </li>
            <li>
              Coordinates can be exact saved site coordinates or city-level approximate
              coordinates depending on what is available.
            </li>
          </ul>
        </article>

        <article className="helpSection">
          <h2>Rounding and Units</h2>
          <ul>
            <li>Dashboard metrics display pounds, gallons, square feet, counts, and USD.</li>
            <li>CO2 is stored internally in metric tons and displayed as pounds.</li>
            <li>Air pollutants are stored internally in grams and displayed as pounds.</li>
            <li>
              Charts use compact rounding for readability. Exports include more detailed
              numeric values for review.
            </li>
            <li>
              All dates are normalized to YYYY-MM-DD and calculated in calendar days, then
              converted to average months for prorating.
            </li>
          </ul>
        </article>

        <article className="helpSection">
          <h2>What to Audit First</h2>
          <ol>
            <li>Confirm the source sheet row counts, planting dates, and planting totals.</li>
            <li>Check any approximate coordinates against known planting locations.</li>
            <li>Review any rows where canopy exists but planting count is missing.</li>
            <li>Review road and energy assumptions before using those dollars externally.</li>
            <li>
              For formal reporting, replace broad fallback values with local i-Tree Eco or
              field-study outputs when available.
            </li>
          </ol>
        </article>
      </section>

      <section className="helpSection helpWideSection">
        <h2>Source Citations</h2>
        <p>
          These links are included for audit review. They explain the public methods behind
          the rates and assumptions used in the dashboard.
        </p>
        <ul className="helpSourceList">
          {sourceLinks.map((source) => (
            <li key={source.href}>
              <a href={source.href} rel="noreferrer" target="_blank">
                {source.label}
              </a>
              <span>{source.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
