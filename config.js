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

function validateFrom(from) {
	let flag = (
		from == 'mongo' || from == 'arango'
		|| ~from.search(/mongo(db)?(\+srv)?:\/\//)
		|| ~from.search(/http(s)?:\/\/.*\.google\.com/)
		|| ~from.search(/http(s)?:\/\/arango(db)?/)
	) || false;

	if (flag) return from;

	console.error([
		` > ERROR:`,
		`Invalid source "${from}" specified.`,
		`Valid sources must be 'arango', 'mongo', 'MongoDB URL' or 'Google Sheets URL'.`,
		`Read more: https://github.com/royalgarter/prestart-config/blob/main/README.md`,
	].join(' '));

	return null;
}

program
	.requiredOption('-f, --from <from>', 'Config from: mongo/gsheet/arangodb/redis/github/gitlab/s3/url', from => validateFrom(from) || process.exit(1))
	.requiredOption('-s, --source <source>', 'Config source: mongo collection name/gsheet name/redis key/git repo/s3 path')
	.requiredOption('-d, --dir <dir>', 'Output directory')
	.option('-e, --dotenv <dotenv>', 'Optional: Dotenv absolute filepath', __dirname + '/.env')
	.option('-q, --query <query>', 'Optional: Config query')
	.option('-i, --init', 'Optional Mode: Initialize from file')
	.parse(process.argv);

const { from, source, dir, init, dotenv } = program.opts();

try { fs.existsSync(dotenv) && require('dotenv').config({path: dotenv}) && console.log(`> SUCCESS: Dotenv is loaded '${dotenv}'`) } catch (ex) {console.dir(ex.message || ex)}

!fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

const exit = (c=0, ...m) => (m?.[0] && console.log(...m)) & process.exit(c);

;(async function main() {
	try {
		if (from.includes('mongo')) await configMongo();
		if (from.match(/sheets?\//i)) await configGSheet();
		if (from.includes('arango')) await configArango();
	} catch (ex) {
		console.error(ex)
	} finally {
		console.log(`\n> SUCCESS: Configs are ${init ? 'initialzed' : 'loaded'} ${init ? 'to' : 'from'}: ` + from);
		clearInterval(loading);
		exit(0);
	}
})();


async function configMongo() {
	const { MongoClient } = require('mongodb');
	const client = new MongoClient(ENV.MONGO_URL || from);
	await client.connect();
	const collection = client.db().collection(source);
	if (init) {
		for (let file of fs.readdirSync(dir)) {
			let filepath = path.join(dir, file);
			let ext = path.extname(file);
			let key = path.basename(file, ext);
			let js = (ext == '.js');
			let yaml = (ext == '.yaml' || ext == '.yml');
			let str = fs.readFileSync(filepath, 'utf8');
			let value = (js || yaml) ? str : JSON.parse(str);
			await collection.updateOne({ key }, { $set: { date: new Date(), key, value, js, yaml }}, {upsert: true});
		}
	} else {
		const configs = await collection.find({}).toArray();
		debugger;
		configs.map(({key, value, js, yaml}) => { try {
			let filepath = path.join(dir, key + (yaml ? '.yaml' : (js ? '.js' : '.json')));
			fs.writeFileSync(filepath, yaml ? YAML.stringify(YAML.parse(value)) : (js ? value : JSON.stringify(value, null, 2)));
		} catch {} })
	}
	await client.close();
};

async function configGSheet() {
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
	if (init) {
		await arangoCollection.truncate();
		for (let file of fs.readdirSync(dir)) {
			let filepath = path.join(dir, file);
			let ext = path.extname(file);
			let key = path.basename(file, ext);
			let js = (ext == '.js');
			let yaml = (ext == '.yaml' || ext == '.yml');
			let str = fs.readFileSync(filepath, 'utf8');
			let value = (js || yaml) ? str : JSON.parse(str);

			await arangoCollection.save({ key, date: new Date(), value, js, yaml }, {overwriteMode: 'update'});
		}
	} else {
		const cursor = await arangoCollection.all();
		const configs = await cursor.all();
		configs.map(({ key, value, js, yaml }) => { try {
			let filepath = path.join(dir, key + (yaml ? '.yaml' : (js ? '.js' : '.json')));
			fs.writeFileSync(filepath, yaml ? YAML.stringify(value) : (js ? value : JSON.stringify(value, null, 2)));
		} catch {} });
	}
	await arango.close();
};