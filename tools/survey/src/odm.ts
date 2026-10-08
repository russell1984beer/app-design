// Runs OpenDroneMap (free photogrammetry software) in Docker on the drone photos.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const ODM_IMAGE = "opendronemap/odm:3.5.6";

/** ODM settings for a garden survey: ground and surface models and the aerial photo, at 2 cm. */
export const ODM_ARGS = ["--dsm", "--dtm", "--dem-resolution", "2", "--orthophoto-resolution", "2", "--skip-3dmodel", "--skip-report"];

export function listPhotos(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`The photo folder was not found: ${dir}`);
  return readdirSync(dir).filter((f) => /\.(jpe?g)$/i.test(f));
}

export function odmOutputs(projectDir: string) {
  return {
    dtm: join(projectDir, "odm_dem", "dtm.tif"),
    dsm: join(projectDir, "odm_dem", "dsm.tif"),
    ortho: join(projectDir, "odm_orthophoto", "odm_orthophoto.tif"),
  };
}

function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<number> {
  return new Promise((done, fail) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let partial = "";
    const feed = (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) onLine?.(l);
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", fail);
    p.on("close", (code) => done(code ?? 1));
  });
}

export async function checkDocker(): Promise<void> {
  let code: number;
  try {
    code = await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch {
    throw new Error("Docker is not installed. Install Docker Desktop (see docs/survey-processing.md), then try again.");
  }
  if (code !== 0) throw new Error("Docker is installed but not running. Open Docker Desktop, wait until it says it is running, then try again.");
}

/**
 * Process the photos. Results go in workDir/project. Progress lines from ODM are passed to
 * onStage in plain words when ODM starts a new stage.
 */
export async function runOdm(photosDir: string, workDir: string, onStage: (text: string) => void, log?: (line: string) => void): Promise<string> {
  const photos = resolve(photosDir);
  const work = resolve(workDir);
  mkdirSync(join(work, "project"), { recursive: true });
  const stages: [RegExp, string][] = [
    [/Running dataset stage|Loading dataset/i, "Reading the photos"],
    [/Running opensfm stage|Running SfM/i, "Matching the photos to each other"],
    [/Running openmvs stage|Densify/i, "Building the 3D point cloud"],
    [/Running odm_filterpoints/i, "Cleaning up the point cloud"],
    [/Running odm_georeferencing/i, "Placing the model on the map"],
    [/Running odm_dem stage/i, "Making the ground and surface height models"],
    [/Running odm_orthophoto stage/i, "Making the aerial photo"],
    [/ODM app finished/i, "Finished"],
  ];
  const code = await run(
    "docker",
    ["run", "--rm", "-v", `${work}:/datasets`, "-v", `${photos}:/datasets/project/images:ro`, ODM_IMAGE, "--project-path", "/datasets", "project", ...ODM_ARGS],
    (line) => {
      log?.(line);
      for (const [re, text] of stages) if (re.test(line)) onStage(text);
    },
  );
  if (code !== 0) throw new Error(`OpenDroneMap stopped with an error (code ${code}). The full log is in ${join(work, "odm-log.txt")}.`);
  return join(work, "project");
}
