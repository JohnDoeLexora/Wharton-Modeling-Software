# API reference

Modules under `src/core`. The section numbers point at `docs/MODEL_SPEC.md`. This list is the public surface of the engine. UI components call these functions. They do not add a second formula.

## Year step and runs

- `stepYear` and `stepYearMut` (`yearStep.ts`). One beginning-of-year step. §5.1.
- `runModel` (`run.ts`). Validates assumptions, draws the sample, and returns metrics, scenarios, the reserve block, and the wealth vectors. Optional `onProgress` receives a percentile snapshot every 50 trials.
- `projectPath` (`project.ts`). One scenario path. The 2031 continuation is §5.3.
- `fillPricedSchedule` (`pricing.ts`). Priced sleeve returns. §4. Kernel flags hook here and only here.

## Generator

- `rawWord`, `unitInterval`, `standardNormal` (`rng.ts`). SplitMix64. §6.1.
- `parityRun`, `parityConfigs` (`parityKernel.ts`). The twenty golden books and five richer books.
- `reference/python/kernel.py`. The same step and the same draws. `sim.py` keeps `bond_price`, `par_dur_conv`, and `curve_y` only. §6.3.

## Kernel flags

- `kernelEngaged`, `markovStep`, `sharedStudentScale`, `sectorFxReturn`, `stepIgSpread`, `issuerDefaultProbability`, `targetDuration`, `binnedCommunicationRange` (`kernel.ts`). §7.1 through §7.7. All of them are no-ops unless the flag is on.

## Statistics and risk

- `frameFromCsv`, `verifyClaims`, `citationTable` (`verifyStats.ts`). §8.
- `decomposeRisk`, `repairCovariance`, `brinson`, `trackingError`, `rollingFactorAttribution`, `effectiveNumberOfBets` (`attribution.ts`). §9.
- `pairedDifference`, `pairedFunded` (`paired.ts`). Common-random-number gaps.
- `buildLadderReport`, `matchCashflows`, `billLadder`, `durationMatch`, `quoteRichness`, `presentValue` (`ladder.ts`). §10. Capital is $300,000.
- `meanCvar`, `resampledFrontier`, `blackLitterman`, `worstCaseMean`, `fundedBreakeven` (`frontier.ts`). §11. Every label says the result is exploration.
- `modelRiskSpread` (`modelRisk.ts`). The same book under return model, shock model, correlation regime, and V6 vol ratios.
- `SCENARIO_LIBRARY`, `replayPath`, `applyFactorShock`, `reverseStress`, `fitMarkov` (`scenarioLib.ts`). §12.

## Exports

- `tearSheetHtml` (`tearSheet.ts`). Prefix `INTERNAL - ` or `EXTERNAL - `.
- `textPdf` (`pdfText.ts`). A text PDF for the in-browser tear sheet.
- `buildBundle`, `reproduceBundle` (`bundle.ts`). §13.
- `workbookBytes` (`xlsx.ts`). A stored-zip workbook for the board.
- `trialsCsv`, `trialsParquetBytes` (`exportData.ts`). Per-trial files.

## Commands

- `npm run verify` runs the tests, the typecheck and the production build, the Bend laws, both parity checks, `verify-stats`, and the headless walkthrough.
- `npm run reproduce -- bundle.json` reruns a bundle.
- `npm run paper` rebuilds `docs/METHODS.pdf` and the figures.
- `npm run perf` checks the three-second budget and the locked median.
- `python3 scripts/fetch_free.py --dry-run` records a fetch attempt without downloading.
