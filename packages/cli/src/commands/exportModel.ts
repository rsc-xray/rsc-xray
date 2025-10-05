import { writeFile } from 'node:fs/promises';

import type { Model } from '@rsc-xray/schemas';
import { analyzeProject } from '@rsc-xray/analyzer';

export interface ExportModelOptions {
  projectRoot: string;
  distDir?: string;
  appDir?: string;
  outputPath: string;
  pretty?: boolean;
}

export async function exportModel({
  projectRoot,
  distDir,
  appDir,
  outputPath,
  pretty = true,
}: ExportModelOptions): Promise<Model> {
  const analyzeOptions = { projectRoot } as Parameters<typeof analyzeProject>[0];
  if (distDir) {
    analyzeOptions.distDir = distDir;
  }
  if (appDir) {
    analyzeOptions.appDir = appDir;
  }

  const model = await analyzeProject(analyzeOptions);
  const json = JSON.stringify(model, null, pretty ? 2 : 0);
  await writeFile(outputPath, json, 'utf8');
  return model;
}
