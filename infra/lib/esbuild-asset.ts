import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';

/**
 * Bundles a single Lambda entry file with esbuild's in-process JS API instead
 * of aws-cdk-lib's default NodejsFunction bundling (which shells out to
 * `npx esbuild` / Docker — both break when the repo path contains `&`, as
 * this one does). Runs entirely locally, no Docker required.
 */
export function bundledLambdaCode(entryFile: string): lambda.Code {
  const entryDir = path.dirname(entryFile);
  return lambda.Code.fromAsset(entryDir, {
    bundling: {
      image: cdk.DockerImage.fromRegistry('unused'), // never used; local.tryBundle always succeeds below
      local: {
        tryBundle(outputDir: string): boolean {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const esbuild = require('esbuild');
          esbuild.buildSync({
            entryPoints: [entryFile],
            outfile: path.join(outputDir, 'index.js'),
            bundle: true,
            minify: true,
            platform: 'node',
            target: 'node20',
            external: ['@aws-sdk/*'],
          });
          return true;
        },
      },
    },
  });
}
