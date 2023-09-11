// test/gcp/function.test.ts
import { test, expect } from "vitest";
import { Function } from "../../src/cloud";
import * as tfGCP from "../../src/target-tf-gcp";
import { Testing } from "../../src/testing";
import { mkdtemp, tfResourcesOf, tfSanitize, treeJsonOf } from "../util";

const INFLIGHT_CODE = `async handle(name) { console.log("Hello, " + name); }`;

const GCP_APP_OPTS = {
  projectId: "my-project",
  storageLocation: "US",
  entrypointDir: __dirname,
};

test("basic function", () => {
  // GIVEN
  const app = new tfGCP.App({ outdir: mkdtemp(), ...GCP_APP_OPTS });
  const inflight = Testing.makeHandler(app, "Handler", INFLIGHT_CODE);

  // WHEN
  Function._newFunction(app, "Function", inflight);
  const output = app.synth();

  // THEN
  expect(tfResourcesOf(output)).toEqual([
    "google_cloudfunctions_function", // Cloud Function
    // "google_project_service", // Enable Cloud Functions API
  ]);
  expect(tfSanitize(output)).toMatchSnapshot();
  expect(treeJsonOf(app.outdir)).toMatchSnapshot();
});

// test("basic function with environment variables", () => {
//     // GIVEN
//     const app = new tfGCP.App({ outdir: mkdtemp(), region: "us-central1" });
//     const inflight = Testing.makeHandler(app, "Handler", INFLIGHT_CODE);

//     // WHEN
//     Function._newFunction(app, "Function", inflight, {
//         environmentVariables: {
//             FOO: "BAR",
//             BOOM: "BAM",
//         },
//     });
//     const output = app.synth();

//     // THEN
//     expect(tfSanitize(output)).toMatchSnapshot();
//     expect(treeJsonOf(app.outdir)).toMatchSnapshot();
// });

// Add more tests as needed for your Google Cloud Functions setup
