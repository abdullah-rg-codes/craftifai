import { Client } from 'pg';
import { pathToFileURL } from 'node:url';
import { databaseUrl } from './env.js';

const command = process.argv[2];

async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(databaseUrl());
  const dbName = url.pathname.slice(1).split('?')[0];
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name');
  }
  url.pathname = '/postgres' + url.search;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createDatabase(): Promise<void> {
  const url = new URL(databaseUrl());
  const dbName = url.pathname.slice(1).split('?')[0];
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name');
  }
  await withAdminClient(async (client) => {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      // eslint-disable-next-line no-console
      console.log(`Created database ${dbName}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Database ${dbName} already exists`);
    }
  });
}

export async function dropDatabase(): Promise<void> {
  const url = new URL(databaseUrl());
  const dbName = url.pathname.slice(1).split('?')[0];
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name');
  }
  await withAdminClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    // eslint-disable-next-line no-console
    console.log(`Dropped database ${dbName}`);
  });
}

async function main(): Promise<void> {
  if (command === 'createDatabase') {
    await createDatabase();
    return;
  }
  if (command === 'dropDatabase') {
    await dropDatabase();
    return;
  }
  console.error('Usage: tsx ./src/cli.ts <createDatabase|dropDatabase>');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
