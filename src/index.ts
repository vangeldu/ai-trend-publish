import { startCronJobs } from "./controllers/cron";
import { ConfigManager } from "./utils/config/config-manager";
import { EnvConfigSource } from "./utils/config/sources/env-config.source";
import { DbConfigSource } from "./utils/config/sources/db-config.source";
import { MySQLDB } from "./utils/db/mysql.db";

async function bootstrap() {
  const configManager = ConfigManager.getInstance();
  configManager.addSource(new EnvConfigSource());

  // const db = await MySQLDB.getInstance({
  //   host: process.env.DB_HOST,
  //   port: Number(process.env.DB_PORT),
  //   user: process.env.DB_USER,
  //   password: process.env.DB_PASSWORD,
  //   database: process.env.DB_DATABASE,
  // });
  // configManager.addSource(new DbConfigSource(db));

  startCronJobs();
}

bootstrap().catch(console.error);
