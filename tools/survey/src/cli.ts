// npm run survey -- --photos <folder of drone photos> --scan <plotwise-scan-….json>
// Optional: --out <file>   where to save the survey (default: next to the scan details file)
//           --odm <folder> skip processing and use an OpenDroneMap project that is already done

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { makeSurvey, readScan } from "./convert.ts";
import { checkDocker, listPhotos, odmOutputs, runOdm } from "./odm.ts";

const { values } = parseArgs({
  options: { photos: { type: "string" }, scan: { type: "string" }, out: { type: "string" }, odm: { type: "string" } },
});

function fail(message: string): never {
  console.error(`\nSTOPPED: ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!values.scan) fail("Say where the scan details file is: --scan \"C:\\...\\plotwise-scan-....json\"");
  if (!values.photos && !values.odm) fail("Say where the drone photos are: --photos \"C:\\...\\photos folder\"");
  const scanPath = resolve(values.scan);
  const scan = readScan(await readFile(scanPath, "utf8"));

  let project: string;
  let photoCount = scan.photoCount;
  if (values.odm) {
    project = resolve(values.odm);
  } else {
    const photos = listPhotos(values.photos!);
    if (photos.length < 5) fail(`Only ${photos.length} photos were found in that folder. Point --photos at the folder with the scan's photos.`);
    photoCount = photos.length;
    console.log(`Found ${photos.length} photos. The scan took ${scan.photoCount}.`);
    await checkDocker();
    const work = join(dirname(resolve(values.photos!)), "plotwise-processing");
    console.log(`Processing with OpenDroneMap. This takes about 10–30 minutes; leave the PC on.\nWorking folder: ${work}`);
    mkdirSync(work, { recursive: true });
    const log = createWriteStream(join(work, "odm-log.txt"), { flags: "w" });
    const started = Date.now();
    let last = "";
    project = await runOdm(values.photos!, work, (stage) => {
      if (stage === last) return;
      last = stage;
      console.log(`  ${Math.round((Date.now() - started) / 60000)} min: ${stage}…`);
    }, (line) => log.write(line + "\n")).catch((e) => fail((e as Error).message));
    log.end();
  }

  const out = odmOutputs(project);
  if (!existsSync(out.dtm)) fail(`No ground model was made (${out.dtm} is missing). Check the photos cover the whole plot.`);
  console.log("Lining the survey up with your plot…");
  const survey = await makeSurvey({
    scan,
    dtm: out.dtm,
    dsm: existsSync(out.dsm) ? out.dsm : undefined,
    ortho: existsSync(out.ortho) ? out.ortho : undefined,
    photoCount,
  });
  const file = values.out ? resolve(values.out) : join(dirname(scanPath), `plotwise-survey-${scan.flownAt.slice(0, 10)}.json`);
  await writeFile(file, JSON.stringify(survey));
  const pct = Math.round(survey.coverage * 100);
  console.log(`\nDone. Survey saved to:\n  ${file}\n`);
  console.log(`The photos covered ${pct}% of the plot.${pct < 90 ? " Gaps are filled in from nearby heights; fly the scan again for a complete survey." : ""}`);
  console.log("Next: send this file to the phone or iPad and open it in Plotwise (Survey tab > Open survey file).");
}

main().catch((e) => fail((e as Error).message));
