'use strict';

const EventEmitter = require('events');
const Sql = require('sql').Sql;

class KeyvSql extends EventEmitter {
	constructor(opts) {
		super();
		this.ttlSupport = false;

		this.opts = Object.assign({
			table: 'keyv',
			keySize: 255
		}, opts);

		const sql = new Sql(opts.dialect);

		this.entry = sql.define({
			name: this.opts.table,
			columns: [
				{
					name: 'key',
					primaryKey: true,
					dataType: `VARCHAR(${Number(this.opts.keySize)})`
				},
				{
					name: 'value',
					dataType: 'TEXT'
				}
			]
		});
		const createTable = this.entry.create().ifNotExists().toString();

		const connected = this.opts.connect()
			.then(query => query(createTable).then(() => query))
			.catch(err => this.emit('error', err));

		this.query = sqlString => connected
			.then(query => query(sqlString));
	}

	get(key) {
		const select = this.entry.select().where({ key }).toString();
		return this.query(select)
			.then(rows => {
				const row = rows[0];
				if (row === undefined) {
					return undefined;
				}
				return row.value;
			});
	}

	set(key, value) {
		let upsert;
		if (this.opts.dialect === 'mysql') {
			value = value.replace(/\\/g, '\\\\');
		}
		if (this.opts.dialect === 'postgres') {
			upsert = this.entry.insert({ key, value }).onConflict({ columns: ['key'], update: ['value'] }).toString();
		} else {
			upsert = this.entry.replace({ key, value }).toString();
		}
		return this.query(upsert);
	}

	setOptimisticly(key, deserialize, serialize, value, tries) {
		tries = tries || 30;
		tries--;

		this.get(key).then(originalValue => {
			const newValue = value(Object.assign({}, originalValue));
			const serializedOriginalValue = serialize(originalValue);
			const serializedValue = serialize(newValue);
			if (serializedValue === serializedOriginalValue ) {
				// No changes
				return;
			}

			let upsert;
			if (this.opts.dialect === 'mysql') {
				serializedValue = serializedValue.replace(/\\/g, '\\\\');
			}
			if (this.opts.dialect === 'postgres') {
				upsert = this.entry.insert({ key, value: serializedValue }).onConflict({ columns: ['key', 'value'], update: ['value'] }).where(
		      this.entry.key.equals(key).and(this.entry.value.equals(serializedOriginalValue))
		    ).toString();
			} else {
				upsert = `REPLACE INTO "keyv" ("key", "value") SELECT '${key}', '${serializedValue}' FROM "keyv" WHERE "keyv"."key" = '${key}' AND "keyv"."value" = '${serializedOriginalValue}'; SELECT changes();`;
				/*
				upsert = this.entry.replace({ key, value: serializedValue }).select().where(
		      this.entry.key.equals(key).and(this.entry.value.equals(serializedOriginalValue))
		    ).toString(); */
			}

			console.log(upsert);
			return this.query(upsert).then(rows => {
				console.info(rows);
				const row = rows[0];
				if (row === undefined && tries > 0) {
					return setOptimisticly(key, deserialize, serialize, value, expires, ttl, tries);
				}

				return row.value;
			});
		});
	}

	delete(key) {
		const select = this.entry.select().where({ key }).toString();
		const del = this.entry.delete().where({ key }).toString();
		return this.query(select)
			.then(rows => {
				const row = rows[0];
				if (row === undefined) {
					return false;
				}
				return this.query(del)
					.then(() => true);
			});
	}

	clear() {
		const del = this.entry.delete(this.entry.key.like(`${this.namespace}:%`)).toString();
		return this.query(del)
			.then(() => undefined);
	}
}

module.exports = KeyvSql;
