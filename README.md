# Prestart Config
## Introduction
Prestart Config is a command-line utility used to load and configure settings from various sources such as MongoDB, Google Sheets, and more.

## Environment Configuration
> [!IMPORTANT]
> Key information users need to know to achieve their goal.
> Before using prestart-config, you need to configure some environment variables as follows:
> In the directory there must be an [`.env`] file and the following variables must be configured 

- `MONGO_URL`: Connection URL to MongoDB (if using MongoDB).
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email of Google service account (if using Google Sheets).
- `GOOGLE_PRIVATE_KEY`: Private key of Google service account (if using Google Sheets).

> [!TIP]
> For a smoother process.
You can obtain the `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` by following the instructions provided by Google [here](https://cloud.google.com/iam/docs/keys-list-get).

Note: For the `GOOGLE_PRIVATE_KEY` environment variable, you need to provide the private key as a string, but keep in mind that this string is often long and distributed. Make sure you copy this string accurately.

## Example Usage: 
> [!NOTE]
> Helpful advice for doing things better or more easily.
   
   * `-f, --from <from>`     Specifies the configuration source. Acceptable values are: ***mongo***, ***Mongo Url***, ***Google Sheet Url***.
   * `-s, --source <source>`  Specifies the configuration source details. For MongoDB, this is the ***collection name***; for Google Sheets, this is the ***sheet name***
   * `-d, --dir <dir>`        Specifies the output directory.
   * `-q, --query <query>`    Specifies a configuration query.
   * `-i, --init`             Initializes the configuration.
   * `-h, --help`            Displays help for the command.

  ### npx
  ```sh
  npx -y prestart-config -f <from> -s <source> -d <dir>
  ```
  1. **Load configuration from MongoDB:** <br>
     * If use config mongo .env<br>
        * Example: `npx -y prestart-config -f mongo -s <collection name> -d <out directory>`<br>
     * If use Mongo URL Connection <br>
        * Example: `npx -y prestart-config -f <mongodb+srv:// ...> -s <collection name> -d <out directory>`
  2. **Load configuration from GoogleSheet:**<br>
        * Example: `npx -y prestart-config -f <Google Sheets URL> -s <sheet name> -d <output directory>`

## Reference Documentation
Detailed reference documentation for prestart-config can be found at [GitHub Pages](https://github.com/royalgarter/prestart-config).
