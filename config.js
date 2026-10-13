#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const YAML = require('yaml');
const { program } = require('commander');

const ENV = process.env, ARGS = process.argv.slice(2);

let loading = setInterval(() => {
					process.stdout.write('\r> loading...|');
	setTimeout(_ => process.stdout.write('\r> loading...\/'), 0.1e3);
	setTimeout(_ => process.stdout.write('\r> loading...\-'), 0.2e3);
	setTimeout(_ => process.stdout.write('\r> loading...\\'), 0.3e3);
}, 0.4e3);

// Hides the password in a connection URL: postgres://user:pass@host/db -> postgres://user:***@host/db
function maskUrl(s) {
	return String(s).replace(/(\/\/[^:\/@\s]+:)[^@\/\s]+@/, '$1***@');
}

function validateFrom(from) {
	let flag = (
		from == 'mongo' || from == 'arango' || from == 'postgres'
		|| ~from.search(/mongo(db)?(\+srv)?:\/\//)
		|| ~from.search(/http(s)?:\/\/.*\.google\.com/)
		|| ~from.search(/http(s)?:\/\/arango(db)?/)
		|| ~from.search(/postgres(ql)?:\/\//)
	) || false;

	if (flag) return from;

	console.error([
		` > ERROR:`,
		`Invalid source "${maskUrl(from)}" specified.`,
		`Valid sources must be 'arango', 'mongo', 'postgres', 'MongoDB URL', 'PostgreSQL URL' or 'Google Sheets URL'.`,
		`Read more: https://github.com/royalgarter/prestart-config/blob/main/README.md`,
	].join(' '));

	return null;
}

program
	.requiredOption('-f, --from <from>', 'Config from: mongo/postgres/gsheet/arangodb/redis/github/gitlab/s3/url, or an env variable name (e.g. DATABASE_URL)')
	.requiredOption('-s, --source <source>', 'Config source: mongo collection name/gsheet name/redis key/git repo/s3 path')
	.option('-d, --dir <dir>', 'Output directory (required unless -e is given)')
	.option('-e, --dotenv <dotenv>', 'Optional: Dotenv absolute filepath', __dirname + '/.env')
	.option('-q, --query <query>', 'Optional: Config query')
	.option('-i, --init', 'Optional Mode: Initialize from file')
	.parse(process.argv);

const { from: rawFrom, source, dir, init, dotenv } = program.opts();
// Env mode: only when -e is passed explicitly (it has a default value otherwise).
const envMode = program.getOptionValueSource('dotenv') === 'cli';

if (!envMode && !dir) {
	console.error(' > ERROR: -d, --dir is required unless -e is given');
	process.exit(1);
}

try { fs.existsSync(dotenv) && require('dotenv').config({path: dotenv}) && console.log(`> SUCCESS: Dotenv is loaded '${dotenv}'`) } catch (ex) {console.dir(ex.message || ex)}

// -f may name an env variable (e.g. `-f DATABASE_URL`). It is resolved after the -e file is loaded.
const isEnvName = /^[A-Z][A-Z0-9_]*$/.test(rawFrom);
if (isEnvName && !ENV[rawFrom]) {
	console.error(` > ERROR: Environment variable "${rawFrom}" is not set (export it or add it to the -e file)`);
	process.exit(1);
}
const from = (isEnvName && ENV[rawFrom]) || rawFrom;
validateFrom(from) || process.exit(1);

dir && !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

const exit = (c=0, ...m) => (m?.[0] && console.log(...m)) & process.exit(c);

;(async function main() {
	try {
		const isPostgres = from == 'postgres' || /^postgres(ql)?:\/\//i.test(from);
		if (isPostgres) await configPostgres();
		else if (from.includes('mongo')) await configMongo();
		if (from.match(/sheets?\//i)) await configGSheet();
		if (!isPostgres && from.includes('arango')) await configArango();
	} catch (ex) {
		console.error(ex)
	} finally {
		console.log(`\n> SUCCESS: Configs are ${init ? 'initialzed' : 'loaded'} ${init ? 'to' : 'from'}: ` + maskUrl(from));
		clearInterval(loading);
		exit(0);
	}
})();


// ---- Last modified wins ----
// Every stored config carries `last_modified` (ms since epoch, the local file's mtime when pushed).
//   push (init): a local file overwrites the database record only if its mtime is strictly newer.
//   pull (load): a database record overwrites the local file only if its last_modified is strictly newer.
// Pulled files get their mtime set to last_modified, so both sides agree and nothing gets re-pushed.

function toMs(v) {
	return (v == null ? 0 : new Date(v).getTime()) || 0;
}

// Returns true when `incomingMs` should overwrite the existing copy (`existingMs`, undefined when missing).
function shouldWrite(key, incomingMs, existingMs) {
	if (existingMs == null || incomingMs > existingMs) return true;
	if (existingMs > incomingMs) console.log(`> SKIP: '${key}' kept existing copy, it was modified later`);
	return false;
}

function readLocalConfigs() {
	return fs.readdirSync(dir).map(file => {
		let filepath = path.join(dir, file);
		let ext = path.extname(file);
		let key = path.basename(file, ext);
		let js = (ext == '.js');
		let yaml = (ext == '.yaml' || ext == '.yml');
		let str = fs.readFileSync(filepath, 'utf8');
		let value = (js || yaml) ? str : JSON.parse(str);
		let last_modified = Math.floor(fs.statSync(filepath).mtimeMs);
		return { key, value, js, yaml, last_modified };
	});
}

function localMtimes() {
	return new Map(fs.readdirSync(dir).map(file => [
		path.basename(file, path.extname(file)),
		Math.floor(fs.statSync(path.join(dir, file)).mtimeMs),
	]));
}

function writeLocalConfig({ key, value, js, yaml, last_modified }) {
	let filepath = path.join(dir, key + (yaml ? '.yaml' : (js ? '.js' : '.json')));
	fs.writeFileSync(filepath, yaml
		? (typeof value == 'string' ? value : YAML.stringify(value))
		: (js ? value : JSON.stringify(value, null, 2)));
	let mtime = new Date(last_modified);
	fs.utimesSync(filepath, mtime, mtime);
}

// ---- Sync engine, shared by every backend ----
// A backend provides a `store`:
//   store.fetch()  -> [{ key, value, js, yaml, last_modified }]
//   store.upsert({ key, value, js, yaml, last_modified })
async function syncStore(store) {
	if (envMode) return init ? envPush(store) : envPull(store);
	return init ? filePush(store) : filePull(store);
}

async function filePush(store) {
	const remote = new Map((await store.fetch()).map(r => [r.key, r.last_modified]));
	for (const config of readLocalConfigs()) {
		if (!shouldWrite(config.key, config.last_modified, remote.get(config.key))) continue;
		await store.upsert(config);
	}
}

async function filePull(store) {
	const local = localMtimes();
	for (const doc of await store.fetch()) {
		if (!shouldWrite(doc.key, doc.last_modified, local.get(doc.key))) continue;
		writeLocalConfig(doc);
	}
}

// ---- Env mode: each variable of a .env file is one record (key = VAR_NAME) ----
// dotenv 9 is line-based: values are literal inside single quotes, and only \n is unescaped inside double quotes.

function formatEnvValue(key, value) {
	if (/^[\w.\/:@+,~-]*$/.test(value)) return value;
	if (!/[\n']/.test(value)) return `'${value}'`;
	if (!/[\n"]/.test(value)) return `"${value}"`;
	if (!value.includes('"')) return `"${value.replace(/\n/g, '\\n')}"`;
	throw new Error(`E_ENV_VALUE_NOT_REPRESENTABLE: ${key}`);
}

// Replaces the changed KEY= lines in place, keeps comments and other lines, appends new keys.
function applyEnvRecords(text, records) {
	const values = new Map(records.map(r => [r.key, r.value]));
	const written = new Set();
	const out = [];

	const lines = text ? text.split(/\r?\n/) : [];
	if (lines.length && lines[lines.length - 1] === '') lines.pop(); // trailing newline, not a line

	for (const line of lines) {
		const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=/);
		if (m && values.has(m[1])) {
			if (!written.has(m[1])) out.push(`${m[1]}=${formatEnvValue(m[1], values.get(m[1]))}`);
			written.add(m[1]); // duplicate lines of the same key are dropped
			continue;
		}
		out.push(line);
	}

	for (const [key, value] of values) {
		if (!written.has(key)) out.push(`${key}=${formatEnvValue(key, value)}`);
	}

	return out.join('\n').replace(/\n+$/, '') + '\n';
}

async function envPush(store) {
	if (!fs.existsSync(dotenv)) throw new Error('E_ENV_FILE_NOT_FOUND');

	const vars = require('dotenv').parse(fs.readFileSync(dotenv));
	const mtime = Math.floor(fs.statSync(dotenv).mtimeMs);
	const remote = new Map((await store.fetch()).map(r => [r.key, r]));

	for (const [key, value] of Object.entries(vars)) {
		const existing = remote.get(key);
		if (existing?.value === value) continue;
		if (!shouldWrite(key, mtime, existing?.last_modified)) continue;
		await store.upsert({ key, value, js: false, yaml: false, last_modified: mtime });
	}
}

async function envPull(store) {
	// Without -d, pull writes straight to the -e file.
	const target = dir ? path.join(dir, '.env') : dotenv;
	const exists = fs.existsSync(target);
	const text = exists ? fs.readFileSync(target, 'utf8') : '';
	const localVars = new Map(Object.entries(require('dotenv').parse(text)));
	const mtime = exists ? Math.floor(fs.statSync(target).mtimeMs) : undefined;

	const apply = (await store.fetch()).filter(r =>
		localVars.get(r.key) !== r.value && shouldWrite(r.key, r.last_modified, mtime));
	if (!apply.length) return;

	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, applyEnvRecords(text, apply));
	const newest = new Date(Math.max(...apply.map(r => r.last_modified)));
	fs.utimesSync(target, newest, newest);
}

async function configMongo() {
	const { MongoClient } = require('mongodb');
	const client = new MongoClient(ENV.MONGO_URL || from);
	await client.connect();
	const collection = client.db().collection(source);

	const store = {
		fetch: async () => (await collection.find({}).toArray()).map(d => ({
			key: d.key, value: d.value, js: !!d.js, yaml: !!d.yaml, last_modified: toMs(d.last_modified ?? d.date),
		})),
		upsert: ({ key, value, js, yaml, last_modified }) => collection.updateOne(
			{ key },
			{ $set: { key, value, js, yaml, last_modified: new Date(last_modified) } },
			{ upsert: true },
		),
	};

	await syncStore(store);
	await client.close();
};

async function configGSheet() {
	if (envMode) throw new Error('E_ENV_MODE_NOT_SUPPORTED_FOR_GSHEET');

	const { GoogleSpreadsheet } = require('google-spreadsheet');
	let id = from;
	if (from.includes('http') || from.includes('/d/')) {
		try {
			let url = new URL(from);
			id = url.pathname.match(/\/d\/([\w\d-]*)/)?.[1] || from;
		} catch {}
	}

	let doc = new GoogleSpreadsheet(id);
	let auth = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE))
	? require(process.env.GOOGLE_SERVICE_ACCOUNT_FILE)
	: {
		"private_key": process.env.GOOGLE_PRIVATE_KEY,
		"client_email": process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
	};

	if (!auth?.private_key || !auth?.client_email) throw new Error('E_GOOGLE_SERVICE_ACCOUNT_ERROR');

	await doc.useServiceAccountAuth(auth);
	let info = await doc.loadInfo();
	if (init) {
		for (let file of fs.readdirSync(dir)) { try {
			let filepath = path.join(dir, file);
			let ext = path.extname(file);
			let key = path.basename(file, ext);
			let js = (ext == '.js');
			let items = require(filepath);

			if (!Array.isArray(items)) throw new Error('E_JSON_FILE_IS_NOT_ARRAY');

			let sheet = doc.sheetsByIndex.find(x => x.title == key);
			if (!sheet) sheet = await doc.addSheet({title: key});
			await sheet.loadCells();

			await sheet.loadHeaderRow();
			let headers = sheet.headerValues;

			if (!headers?.length) sheet.addRow(Object.keys(items[0]));

			await sheet.addRows(items.map(item => Object.values(items)));
		} catch {} }
	} else {
		let sheet = doc.sheetsByIndex.find(x => x.title == source);
		if (!sheet) throw new Error('E_SHEETNAME_NOT_FOUND');

		await sheet.loadCells();

		let rows = await sheet.getRows();
		let headers = sheet.headerValues;

		let objs = rows.map( row => Object.fromEntries(headers.map(h => [h, row[h]])) )

		let filepath = path.join(dir, source + '.json');
		fs.writeFileSync(filepath, JSON.stringify(objs, null, 2));
	}
};

async function configArango() {
	const { Database , aql} = require('arangojs');
	const url = new URL(ENV.ARANGO_URL);

	let arango = new Database({
		url: url.protocol + "//" + url.host,
		databaseName: url.pathname.replaceAll('/', ''),
		auth: { username: url.username, password: url.password},
	});

	const arangoCollection = arango.collection(source);

	const store = {
		fetch: async () => (await (await arangoCollection.all()).all()).map(d => ({
			key: d.key, value: d.value, js: !!d.js, yaml: !!d.yaml, last_modified: toMs(d.last_modified ?? d.date),
		})),
		// UPSERT by `key` (no truncate, so records newer than the local files are kept and no duplicates appear).
		upsert: ({ key, value, js, yaml, last_modified }) => {
			const lm = new Date(last_modified).toISOString();
			return arango.query(aql`
				UPSERT { key: ${key} }
				INSERT { key: ${key}, value: ${value}, js: ${js}, yaml: ${yaml}, last_modified: ${lm} }
				UPDATE { value: ${value}, js: ${js}, yaml: ${yaml}, last_modified: ${lm} }
				IN ${arangoCollection}
			`);
		},
	};

	await syncStore(store);
	await arango.close();
};

async function configPostgres() {
	const { Pool } = require('pg');
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(source)) throw new Error('E_POSTGRES_INVALID_TABLE_NAME');

	const pool = new Pool({ connectionString: /^postgres(ql)?:\/\//i.test(from) ? from : ENV.POSTGRES_URL });
	const table = `"${source}"`;
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS ${table} (
				key TEXT PRIMARY KEY,
				value JSONB,
				js BOOLEAN NOT NULL DEFAULT FALSE,
				yaml BOOLEAN NOT NULL DEFAULT FALSE,
				last_modified TIMESTAMPTZ NOT NULL
			)
		`);

		const store = {
			fetch: async () => (await pool.query(`SELECT key, value, js, yaml, last_modified FROM ${table}`)).rows.map(r => ({
				key: r.key, value: r.value, js: r.js, yaml: r.yaml, last_modified: toMs(r.last_modified),
			})),
			// The WHERE guard also protects against a newer write that lands between our SELECT and this UPSERT.
			upsert: ({ key, value, js, yaml, last_modified }) => pool.query(`
				INSERT INTO ${table} (key, value, js, yaml, last_modified) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (key) DO UPDATE SET
					value = EXCLUDED.value, js = EXCLUDED.js, yaml = EXCLUDED.yaml, last_modified = EXCLUDED.last_modified
				WHERE ${table}.last_modified < EXCLUDED.last_modified
			`, [key, JSON.stringify(value), js, yaml, new Date(last_modified)]),
		};

		await syncStore(store);
	} finally {
		await pool.end();
	}
};
