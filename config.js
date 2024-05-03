'use strict'

const fs = require('fs');
const path = require('path');

const YAML = require('yaml');
const { program } = require('commander');

fs.existsSync(__dirname + '/.env') && require('dotenv').config();
const ENV = process.env, ARGS = process.argv.slice(2);

program
	.option('-f, --from <from>', 'Config from: mongo/gsheet/redis/github/gitlab/s3/url')
	.option('-d, --dir <dir>', 'Output directory')
	.option('-s, --source <source>', 'Config source: mongo collection name/gsheet name/redis key/git repo/s3 path')
	.option('-q, --query <query>', 'Config query')
	.option('-i, --init', 'init')

program.parse(process.argv);
const PARAMS = program.opts(); console.dir(PARAMS);

const CONFIG_DIR = path.join(PARAMS.dir);

!fs.existsSync(CONFIG_DIR) && fs.mkdirSync(CONFIG_DIR, { recursive: true });

const exit = (c=0, ...m) => (m?.[0] && console.log(...m)) & process.exit(c);

;(async function main() {
	try {
		let {from} = PARAMS;

		if (from.includes('mongo')) await configMongo();

	} catch (ex) {
		console.log(ex)
	} finally {
		exit(0);
	}
})();

async function configMongo () {
	const { MongoClient } = require('mongodb');
	const client = new MongoClient(ENV.MONGO_URL || PARAMS.from);
	await client.connect();
  	const collection = client.db().collection(PARAMS.source);

  	if (PARAMS.init) {
  		for (let file of fs.readdirSync(CONFIG_DIR)) {
			let filepath = path.join(CONFIG_DIR, file);
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
			let filepath = path.join(CONFIG_DIR, key + (yaml ? '.yaml' : (js ? '.js' : '.json')));
			fs.writeFileSync(filepath, yaml ? YAML.stringify(value) : (js ? value : JSON.stringify(value, null, 2)));
		})
  	}

  	await client.close();
}


