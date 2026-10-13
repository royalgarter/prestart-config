# Prestart Config
## Introduction
Prestart Config is a command-line utility used to load and configure settings from various sources such as MongoDB, PostgreSQL, ArangoDB, Google Sheets, and more.

- **Load (default):** copies the stored configs from the source into the `-d` directory.
- **Init (`-i`):** pushes the files in the `-d` directory into the source.

## Environment Configuration
> [!IMPORTANT]
> The connection URLs are read from environment variables. The `-e` default is the `.env` file inside the package folder (not your project), so your project `.env` is not loaded automatically. Use one of the methods in [Using a `.env` file](#using-a-env-file).

| Variable | Used by | Description |
| --- | --- | --- |
| `MONGO_URL` | `-f mongo` | MongoDB connection URL. |
| `ARANGO_URL` | `-f arango` | ArangoDB URL including user, password and database, e.g. `http://root:pass@localhost:8529/_system`. |
| `POSTGRES_URL` | `-f postgres` | PostgreSQL connection URL. If unset, `pg` uses the standard `PG*` variables (`PGHOST`, `PGUSER`, ...). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Sheets | Email of the Google service account. |
| `GOOGLE_PRIVATE_KEY` | Google Sheets | Private key of the Google service account. |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Google Sheets | Optional: path to the service account JSON file instead of the two variables above. |

> [!TIP]
> You can get `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` by following the instructions from Google [here](https://cloud.google.com/iam/docs/keys-list-get).
> The private key is long. Keep it in one line in `.env` with `\n` for line breaks, wrapped in double quotes.

### Using a `.env` file
Example `.env` in your project:

```sh
MONGO_URL=mongodb://user:pass@localhost:27017/app
ARANGO_URL=http://root:pass@localhost:8529/_system
POSTGRES_URL=postgres://user:pass@localhost:5432/app
GOOGLE_SERVICE_ACCOUNT_EMAIL=config-reader@my-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Load it in one of these ways:

```sh
# 1. Export the variables into the current shell (bash/zsh)
set -a; . ./.env; set +a
npx -y prestart-config -f postgres -s app_config -d ./configs

# 2. Node.js 20.6+ reads the file directly (needs a local install: npm i prestart-config)
node --env-file=.env node_modules/prestart-config/config.js -f mongo -s configs -d ./configs

# 3. Pass the variables inline for a single run
POSTGRES_URL="postgres://user:pass@localhost:5432/app" npx -y prestart-config -f postgres -s app_config -d ./configs
```

> [!NOTE]
> Do not pass your connection `.env` to `-e`. Passing `-e` turns on [Env Mode](#env-mode-env-file), which syncs every variable of that file into the database.

## Options

| Option | Description |
| --- | --- |
| `-f, --from <from>` | Source: `mongo`, `postgres`, `arango`, a `mongodb://` or `postgres://` URL, a Google Sheets URL, or the name of an environment variable holding one of those URLs (e.g. `-f DATABASE_URL`). A variable name is read after the `-e` file is loaded. |
| `-s, --source <source>` | MongoDB collection, PostgreSQL table, ArangoDB collection, or Google Sheet name. PostgreSQL names must be letters, digits and `_`. |
| `-d, --dir <dir>` | Directory to read from (`-i`) or write to (load). Created if missing. Required, except in Env Mode (`-e`). |
| `-i, --init` | Push the files in `-d` into the source. |
| `-e, --dotenv <path>` | Env file to read. Passing it explicitly turns on Env Mode. |
| `-q, --query <query>` | Accepted but not used yet. |
| `-h, --help` | Show help. |

File names become keys: `app.json` is stored as key `app`. Files ending in `.js` are stored as text with `js: true`; `.yaml` and `.yml` are stored as text with `yaml: true`.

## Examples

### MongoDB
```sh
# Load collection "configs" into ./configs (MONGO_URL from the environment)
npx -y prestart-config -f mongo -s configs -d ./configs

# Use a connection URL directly
npx -y prestart-config -f "mongodb+srv://user:pass@cluster.example.net/app" -s configs -d ./configs

# Push ./configs into the collection
npx -y prestart-config -f mongo -s configs -d ./configs -i
```

### PostgreSQL
The table is created automatically if it does not exist.

```sh
# Load table "app_config" (POSTGRES_URL from the environment)
npx -y prestart-config -f postgres -s app_config -d ./configs

# Use a connection URL directly
npx -y prestart-config -f "postgres://user:pass@localhost:5432/app" -s app_config -d ./configs

# Push ./configs into the table
npx -y prestart-config -f postgres -s app_config -d ./configs -i
```

### ArangoDB
The collection must already exist.

```sh
# Load collection "configs" (ARANGO_URL from the environment)
npx -y prestart-config -f arango -s configs -d ./configs

# Push ./configs into the collection
npx -y prestart-config -f arango -s configs -d ./configs -i
```

### Google Sheets
Each sheet is one config. Set the service account variables first.

```sh
# Load sheet "Settings" from a spreadsheet URL into ./configs/Settings.json
npx -y prestart-config -f "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit" -s Settings -d ./configs
```

### Expected output
```sh
$ npx -y prestart-config -f postgres -s app_config -d ./configs
> SUCCESS: Configs are loaded from: postgres

$ npx -y prestart-config -f postgres -s app_config -d ./configs -i
> SUCCESS: Configs are initialzed to: postgres

# When the stored copy is newer than the local file, the push skips it:
> SKIP: 'app' kept existing copy, it was modified later
```

## Conflict Handling (last modified wins)
Every stored config keeps a `last_modified` timestamp (the local file's modification time when it was pushed).
- `-i, --init` (push): a local file overwrites the stored config only if the file was modified **later** than the stored copy.
- Load (pull): a stored config overwrites the local file only if it was modified **later** than the local file. Pulled files get the stored timestamp as their modification time, so they are not pushed back unnecessarily.

Applies to MongoDB, ArangoDB and PostgreSQL. `-i` does not truncate the collection or table, so records that are newer than the local files are kept.

Timestamps come from clocks on different machines, so keep them in sync (NTP). A fresh `git clone` sets every file's mtime to the checkout time, which makes those files look newer than the database.

## Env Mode (`.env` file)
Pass `-e` explicitly to sync a `.env` file instead of the files in `-d`. Each variable is stored as one record (`key` = variable name). Use a dedicated file and a dedicated collection or table, because the values are stored in plain text.

```sh
# app.env
APP_NAME=demo
LOG_LEVEL="debug mode"
```

```sh
# Push app.env into table "app_env" (-d is not needed)
npx -y prestart-config -f postgres -s app_env -e ./app.env -i

# Pull into ./envout/.env (keeps comments and other lines, changes only the variables that differ)
npx -y prestart-config -f postgres -s app_env -e ./envout/.env

# Or pull into a folder: writes ./envout/.env
npx -y prestart-config -f postgres -s app_env -d ./envout -e ./app.env
```

- Push writes only variables whose value differs from the database, and only if the file is newer than the stored record.
- Pull writes `<dir>/.env` (or the `-e` file without `-d`). It writes every variable that is missing or different in the database, regardless of the file's modification time, and keeps comments and unrelated lines. The database wins on pull.
- Env mode works with MongoDB, ArangoDB and PostgreSQL only. It does not work with Google Sheets.

> [!WARNING]
> Pull overwrites local values that differ from the database, even if you edited the file more recently. Edits you have not pushed yet will be lost on pull, so run `-i` first to push them.
>
> Push is checked against the whole file's modification time, not per variable. If you edit one variable, every variable whose value differs from the database is pushed when the file is newer. A stale value in the file can therefore overwrite a newer database value for another variable. Pull first, then edit and push.

## Reference Documentation
Detailed reference documentation for prestart-config can be found at [GitHub Pages](https://github.com/royalgarter/prestart-config).
