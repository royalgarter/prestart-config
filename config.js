#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const dotenv =__dirname + '/.env';// console.log(dotenv)
try { fs.existsSync(dotenv) && require('dotenv').config() && console.log(' > SUCCESS: Dotenv is loaded ' + dotenv); } catch {}

const YAML = require('yaml');
const { program } = require('commander');

const ENV = process.env, ARGS = process.argv.slice(2);

const loadingInterval = setInterval(() => {
	process.stdout.write('\r Loading.../');
	setTimeout(() => process.stdout.write('\r Loading... -'), 100);
	setTimeout(() => process.stdout.write('\r Loading... \\'), 200);
}, 300);

function validationFrom(from) {
    if (from === 'mongo' || from.startsWith('mongodb+srv://') || from.startsWith('https://docs.google.com/')) {
        return true;
    } 
	console.error(` > ERROR: Invalid source "${from}" specified. Valid sources must be 'mongo', a 'MongoDB URL', or a 'Google Sheets URL'`);
	console.error(` > Please read the documentation at: https://github.com/royalgarter/prestart-config/blob/main/README.md`);
	return false;
}

program
    .requiredOption('-f, --from <from>', 'Config from: mongo/gsheet/redis/github/gitlab/s3/url', (from) => validationFrom(from) ? from : process.exit(1))
    .requiredOption('-s, --source <source>', 'Config source: mongo collection name/gsheet name/redis key/git repo/s3 path')
    .requiredOption('-d, --dir <dir>', 'Output directory')
    .option('-q, --query <query>', 'Config query')
    .option('-i, --init', 'init')
    .parse(process.argv);

const { from, source, dir, init } = program.opts();

!fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

const exit = (c=0, ...m) => (m?.[0] && console.log(...m)) & process.exit(c);

;(async function main() {
	try {
		if (from.includes('mongo')) await configMongo();
		if (from.match(/sheets?\//i)) await configGSheet();
	} catch (ex) {
		console.error(ex)
	} finally {
		console.log(`\n> SUCCESS: Configs are ${init ? 'initialzed' : 'loaded'} from: ` + from)
		clearInterval(loadingInterval);
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
			let value = (js || yaml) ? fs.readFileSync(filepath, 'utf8') : require(filepath);
			await collection.updateOne({ key }, { date: new Date(), key, value, js, yaml}, {upsert: true});
		}
	} else {
		const configs = await collection.find({}).toArray();
		configs.map(({key, value, js, yaml}) => {
			let filepath = path.join(dir, key + (yaml ? '.yaml' : (js ? '.js' : '.json')));
			fs.writeFileSync(filepath, yaml ? YAML.stringify(value) : (js ? value : JSON.stringify(value, null, 2)));
		})
	}
	await client.close();
}


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
	
	if (!auth?.private_key || !auth?.client_email) return console.error('E_GOOGLE_SERVICE_ACCOUNT_ERROR');
	
	await doc.useServiceAccountAuth(auth);
	let info = await doc.loadInfo();
	if (init) {
		for (let file of fs.readdirSync(dir)) {
			let filepath = path.join(dir, file);
			let ext = path.extname(file);
			let key = path.basename(file, ext);
			let js = (ext == '.js');
			let items = require(filepath);

			if (!Array.isArray(items)) return console.error('\nE_JSON_FILE_IS_NOT_ARRAY');

			let sheet = doc.sheetsByIndex.find(x => x.title == key);
			if (!sheet) sheet = await doc.addSheet({title: key});
			await sheet.loadCells();

			await sheet.loadHeaderRow();
			let headers = sheet.headerValues;

			if (!headers?.length) sheet.addRow(Object.keys(items[0]));

			await sheet.addRows(items.map(item => Object.values(items)));
		}
	} else {
		let sheet = doc.sheetsByIndex.find(x => x.title == source);
		if (!sheet) return console.error('\nE_SHEETNAME_NOT_FOUND');

		await sheet.loadCells();

		let rows = await sheet.getRows();
		let headers = sheet.headerValues;

		let objs = rows.map( row => Object.fromEntries(headers.map(h => [h, row[h]])) )

		let filepath = path.join(dir, source + '.json');
		fs.writeFileSync(filepath, JSON.stringify(objs, null, 2));
	}
}