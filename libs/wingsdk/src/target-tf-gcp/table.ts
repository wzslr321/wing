import { Construct } from "constructs";
import { App } from "./app";
import {
	BigtableInstance,
	BigtableInstanceCluster,
	BigtableInstanceClusterAutoscalingConfig,
	BigtableInstanceConfig,
} from "../.gen/providers/google/bigtable-instance";
import {
	BigtableTable,
	BigtableTableConfig,
	BigtableTableColumnFamily,
} from "../.gen/providers/google/bigtable-table";
import * as ex from "../ex";
import {
	ResourceNames,
	NameOptions,
	CaseConventions,
} from "../shared/resource-names";
import { Function as GCPFunction } from "./function";
import { IInflightHost, Json } from "../std";
import * as  core from "../core";

const TABLE_NAME_OPTS: NameOptions = {
	maxLen: 22,
	disallowedRegex: /[a-z0-9\-\.\_]+/g,
	sep: "a",
};

const INSTANCE_NAME_OPTS: NameOptions = {
	maxLen: 22,
	disallowedRegex: /[a-z0-9\-\.\_]+/g,
	sep: "a",
	case: CaseConventions.LOWERCASE,
};

enum BigtablePermissions {
	READ = "roles/bigtable.viewer",
	READWRITE = "roles/bigtable.user",
}

/**
 * GCP implementation of `ex.Table`.
 *
 * @inflight `@winglang/sdk.ex.ITableClient`
 */
export class Table extends ex.Table {
	constructor(scope: Construct, id: string, props: ex.TableProps = {}) {
		super(scope, id, props);

		if (props.initialRows) {
			throw new Error(
				`property initialRows is not supported for the GCP target`
			);
		}

		const app = App.of(this) as App;

		const tableName = ResourceNames.generateName(this, TABLE_NAME_OPTS);
		const instanceName = ResourceNames.generateName(this, INSTANCE_NAME_OPTS);

		const columnsFamily: BigtableTableColumnFamily[] = [];
		for (let key in this.columns) {
			columnsFamily.push({ family: key });
		}

		const autoscalingConfig: BigtableInstanceClusterAutoscalingConfig = {
			minNodes: 1,
			maxNodes: 3,
			cpuTarget: 35,
		};

		const instanceCluster: BigtableInstanceCluster = {
			clusterId: "default",
			storageType: "SSD",
			zone: app.zone,
			autoscalingConfig: autoscalingConfig,
		};

		const instanceConfig: BigtableInstanceConfig = {
			name: instanceName,
			cluster: [instanceCluster],
		};

		let instance = new BigtableInstance(this, "Instance", instanceConfig);

		const tableConfig: BigtableTableConfig = {
			name: tableName,
			instanceName: instance.name,
			columnFamily: columnsFamily,
			project: app.projectId,
		};

		new BigtableTable(this, "Default", tableConfig);
	}

	public addRow(_key: string, _row: Json): void {
		throw new Error(
			"Method is not supported as a preflight for the GCP target."
		);
	}

	public bind(host: IInflightHost, ops: string[]): void {
		if (!(host instanceof GCPFunction)) {
			throw new Error("Table can only be bound by tfgcp.Function");
		}

		let tableInflightMethods = ex.TableInflightMethods;
		let permissionName = BigtablePermissions.READ;
		if (
			ops.includes(tableInflightMethods.DELETE) ||
			ops.includes(tableInflightMethods.UPDATE) ||
			ops.includes(tableInflightMethods.UPSERT)) {
			permissionName = BigtablePermissions.READWRITE;
		}
		host.addPermission(this, { roleDefinitionName: permissionName });
		super.bind(host, ops);

	}

	public _toInflight(): string {
		return core.InflightClient.for(__dirname.replace("target-tf-gcp", "shared-gcp"),
			__filename,
			"TableClient",
			[
				`process.env["${this.envName()}"]`,
				`process.env["${this.primaryKeyEnvName()}"]`,
				`process.env["${this.columnsEnvName()}"]`,
			]
		);
	}

	private envName(): string {
		return `BIGTABLE_TABLE_NAME_${this.node.addr.slice(-8)}`;
	}

	private primaryKeyEnvName(): string {
		return `${this.envName()}_PRIMARY_KEY`;
	}

	private columnsEnvName(): string {
		return `${this.envName()}_COLUMNS`;
	}
}
