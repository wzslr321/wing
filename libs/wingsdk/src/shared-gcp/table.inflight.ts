import { Bigtable, Table } from "@google-cloud/bigtable";
import { ITableClient } from "../ex";
import { validateRow } from "../shared/table-utils";
import { Json } from "../std";

export class TableClient implements ITableClient {
	private table: Table;

	constructor(
		private readonly tableName: string,
		private readonly instanceId: string,
		private readonly columns: string,
		private readonly client = new Bigtable({ projectId: process.env.GOOGLE_PROJECT_ID }),
	) {
		const instance = this.client.instance(this.instanceId);
		this.table = instance.table(this.tableName);
		this.validateTable();
	}

	private async validateTable() {
		const [tableExists] = await this.table.exists();
		if (!tableExists) {
			throw new Error(`Table with name ${this.tableName} does not exist for an instance with id: ${this.instanceId}`)
		}
	}

	public async insert(key: string, row: Json): Promise<void> {
		validateRow(row, JSON.parse(this.columns));

		const insertRow = { key: key, ...row };

		const [exists] = await this.table.row(key).exists();
		if (exists) {
			throw new Error(`Row with key=${key} already exists in the table`);
		}

		await this.table.insert(insertRow)
	}
	public async upsert(key: string, row: Json): Promise<void> {
		validateRow(row, JSON.parse(this.columns));

		const tableRow = this.table.row(key);
		const [exists] = await tableRow.exists();
		if (exists) {
			return this.update(key, row);
		}
		return this.insert(key, row);
	}

	public async update(key: string, row: Json): Promise<void> {
		validateRow(row, JSON.parse(this.columns));

		const tableRow = this.table.row(key);
		const [exists] = await tableRow.exists();
		if (!exists) {
			throw new Error(`Row with key=${key} does not exist in the table`);
		}
		for (const [column, value] of Object.entries(row)) {
			const [family] = column.split(':')
			await tableRow.save(family, value) // TODO(wiktor.zajac) verify
		}
	}
	public async delete(key: string): Promise<void> {
		const row = this.table.row(key);
		const [exists] = await row.exists();
		if (!exists) {
			throw new Error(`Row with key=${key} does not exist in the table`);
		}
		await row.delete()
	}
	public async get(key: string): Promise<Json> {
		const rowReference = this.table.row(key);
		const [exists] = await rowReference.exists();
		if (!exists) {
			throw new Error(`Row with key=${key} does not exist in the table`);
		}
		const [row] = await rowReference.get();
		return Json.parse(row.data);
	}
	public async tryGet(key: string): Promise<Json | undefined> {
		const rowReference = this.table.row(key);
		const [exists] = await rowReference.exists();
		if (!exists) {
			return undefined;
		}
		const [row] = await rowReference.get();
		return Json.parse(Json.stringify(row.data));
	}
	public async list(): Promise<Json[]> {
		const [rows] = await this.table.getRows()
		const jsonRows: Json[] = [];
		rows.forEach((row) => jsonRows.push(Json.parse(row.data)));

		return jsonRows;
	}
}
