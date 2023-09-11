import * as fs from "fs";
import { AssetType, TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { App } from "./app";
import { CloudfunctionsFunction } from "../.gen/providers/google/cloudfunctions-function";
import { CloudfunctionsFunctionIamPolicy } from "../.gen/providers/google/cloudfunctions-function-iam-policy";
import { StorageBucket } from "../.gen/providers/google/storage-bucket";
import { StorageBucketObject } from "../.gen/providers/google/storage-bucket-object";
import * as cloud from "../cloud";
import * as core from "../core";
import { createBundle } from "../shared/bundling";
import {
  CaseConventions,
  NameOptions,
  ResourceNames,
} from "../shared/resource-names";
import { IResource } from "../std";

const FUNCTION_NAME_OPTS: NameOptions = {
  maxLen: 32,
  disallowedRegex: /[^a-z0-9]+/g,
  case: CaseConventions.LOWERCASE,
};

const BUCKET_NAME_OPTS: NameOptions = {
  maxLen: 54,
  case: CaseConventions.LOWERCASE,
  disallowedRegex: /([^a-z0-9_\-]+)/g,
  includeHash: false,
};

export interface ScopedRoleAssignment {
  /** The azure scope ie. /subscription/xxxxx/yyyyy/zzz */
  readonly scope: string;
  /** Role definition to assign */
  readonly roleDefinitionName: string;
}

/**
 * Google Cloud Function implementation of `cloud.Function`.
 */
export class Function extends cloud.Function {
  private readonly function: CloudfunctionsFunction;
  private permissions?: Map<string, Set<ScopedRoleAssignment>>;
  private readonly bucket: StorageBucket;
  private readonly bucketObject: StorageBucketObject;

  constructor(
    scope: Construct,
    id: string,
    inflight: cloud.IFunctionHandler,
    props: cloud.FunctionProps = {}
  ) {
    super(scope, id, inflight, props);

    const app = App.of(this) as App;
    const functionName = ResourceNames.generateName(this, FUNCTION_NAME_OPTS);
    const bucketName = ResourceNames.generateName(this, BUCKET_NAME_OPTS);

    const bundle = createBundle(this.entrypoint);
    const codeDir = bundle.directory;
    const outDir = `${codeDir}/${functionName}`;

    fs.mkdirSync(`${codeDir}/${functionName}`);
    fs.renameSync(bundle.entrypointPath, `${outDir}/index.js`);

    fs.writeFileSync(
      `${outDir}/function.json`,
      JSON.stringify({
        bindings: [
          {
            authLevel: "anonymous", // TODO: this auth level will be changed with https://github.com/winglang/wing/issues/1371
            type: "httpTrigger",
            direction: "in",
            name: "req",
            methods: ["get"],
          },
          {
            type: "http",
            direction: "out",
            name: "res",
          },
        ],
      })
    );

    if (props.timeout) {
      // Write host.json file to set function timeout (must be set in root of function app)
      // this means that timeout is set for all functions in the function app
      fs.writeFileSync(
        `${codeDir}/host.json`,
        JSON.stringify({
          functionTimeout: `${props.timeout.hours}:${props.timeout.minutes}:${props.timeout.seconds}`,
        })
      );
    }

    // Create zip asset from function code
    const asset = new TerraformAsset(this, "Asset", {
      path: `${codeDir}`,
      type: AssetType.ARCHIVE,
    });

    // Create the Google Cloud Storage Bucket
    this.bucket = new StorageBucket(this, "FunctionCodeBucket", {
      name: `${bucketName}-function-code-bucket`,
      project: app.projectId,
      location: app.storageLocation,
    });

    // Create the Google Cloud Storage Bucket Object
    this.bucketObject = new StorageBucketObject(
      this,
      "FunctionCodeBucketObject",
      {
        name: `${this.bucket.name}-function-code-bucket-object${asset.type}`,
        bucket: this.bucket.name,
        source: asset.path,
      }
    );

    // Create the Google Cloud Function
    this.function = new CloudfunctionsFunction(this, functionName, {
      name: functionName,
      description: "Function created by Wing",
      runtime: "nodejs16",
      sourceArchiveBucket: this.bucket.name,
      sourceArchiveObject: this.bucketObject.name,
      entryPoint: "handler",
      triggerHttp: true,
      availableMemoryMb: 128,
      timeout: 60,
      project: app.projectId,
    });

    // // Create the Google Cloud IAM binding for the function
    new CloudfunctionsFunctionIamPolicy(this, "FunctionIamPolicy", {
      project: app.projectId,
      region: app.storageLocation,
      cloudFunction: this.function.name,
      policyData: JSON.stringify({
        bindings: [
          {
            role: "roles/cloudfunctions.viewer",
            members: ["allUsers"],
          },
        ],
      }),
    });

    // Apply permissions from bound resources
    for (const key of this.permissions?.keys() || []) {
      for (const scopedRoleAssignment of this.permissions?.get(key) ?? []) {
        new CloudfunctionsFunctionIamPolicy(this, `FunctionIamPolicy-${key}`, {
          project: app.projectId,
          region: app.storageLocation,
          cloudFunction: this.function.name,
          policyData: JSON.stringify({
            bindings: [
              {
                role: scopedRoleAssignment.roleDefinitionName,
                members: [scopedRoleAssignment.scope],
              },
            ],
          }),
        });
      }
    }
  }

  public addPermission(
    resource: IResource,
    scopedRoleAssignment: ScopedRoleAssignment
  ): void {
    const app = App.of(this) as App;
    if (!this.permissions) {
      this.permissions = new Map();
    }
    const uniqueId = resource.node.addr.substring(-8);

    if (
      this.permissions.has(uniqueId) &&
      this.permissions.get(uniqueId)?.has(scopedRoleAssignment)
    ) {
      return; // already exists
    }

    if (this.function) {
      new CloudfunctionsFunctionIamPolicy(
        this,
        `FunctionIamPolicy-${uniqueId}`,
        {
          project: app.projectId,
          region: app.storageLocation,
          cloudFunction: this.function.name,
          policyData: JSON.stringify({
            bindings: [
              {
                role: scopedRoleAssignment.roleDefinitionName,
                members: [scopedRoleAssignment.scope],
              },
            ],
          }),
        }
      );
    }

    const scopedRoleAssignments = this.permissions.get(uniqueId) ?? new Set();
    scopedRoleAssignments.add(scopedRoleAssignment);
    this.permissions.set(uniqueId, scopedRoleAssignments);
  }

  /** @internal */
  public _toInflight(): string {
    return core.InflightClient.for(
      __dirname.replace("target-tf-gcp", "shared-gcp"),
      __filename,
      "FunctionClient",
      [`process.env["${this.envName()}"], "${this.node.path}"`]
    );
  }

  private envName(): string {
    return `FUNCTION_NAME_${this.node.addr.slice(-8)}`;
  }
}
